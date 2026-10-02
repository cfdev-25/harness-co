"""AWS Secrets Manager + STS (04 §7.2, 11 §5).

Temporary keys are assumed, used server-side to fetch the value, and
discarded (D68). What travels to the proxy is the secret's value as
`kind: "stored"` (11 D120 amends 04 §7.2's bullet), under a lease. We hold
`GetSecretValue`, `DescribeSecret` and optionally `ListSecrets` — never a
write action (V2).

`sts` and `client_for` are injected, boto3-shaped: nothing here imports an AWS
SDK, so the recorded-fixture tests (§5.10) run without one.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.domain.resolvers import Minted, Probe, SessionContext

# 11 §5.8. Every message a person sees about this vault is one of these.
FAILURES: dict[str, tuple[str, str]] = {
    "vault.aws.assume_denied": (
        "We could not assume `{role_arn}`.",
        "Check the trust policy names our role and the external id shown on this page.",
    ),
    "vault.aws.external_id_not_required": (
        "`{role_arn}` can be assumed without the external id, so we have not saved it.",
        "Add the `sts:ExternalId` condition to the trust policy, then connect again.",
    ),
    "vault.aws.tag_session_denied": (
        "The role does not allow `sts:TagSession`.",
        "Add the second statement from the checklist; without it sessions cannot be "
        "attributed to a person.",
    ),
    "vault.aws.duration_exceeds_max": (
        "`{seconds}` s is longer than this role allows (chained sessions are capped at "
        "one hour).",
        "Lower `duration_seconds` in the group, or raise the role's maximum session duration.",
    ),
    "vault.aws.describe_denied": (
        "`{ref}` is named by a group but the role may not describe it.",
        "Add `secretsmanager:DescribeSecret` for that ARN.",
    ),
    "vault.aws.secret_not_found": (
        "`{ref}` does not exist in `{region}`.",
        "Fix the reference in the group, or the region on this vault.",
    ),
    "vault.aws.scheduled_deletion": (
        "`{ref}` is scheduled for deletion.",
        "Restore it in AWS, or point the group elsewhere.",
    ),
    "vault.aws.throttled": (
        "AWS is rate-limiting requests from our account.",
        "Run again in a moment.",
    ),
}
# botocore error code → our code, for the calls this resolver makes (11 §5.4).
_DESCRIBE_ERRORS = {
    "AccessDeniedException": "vault.aws.describe_denied",
    "ResourceNotFoundException": "vault.aws.secret_not_found",
    "ThrottlingException": "vault.aws.throttled",
}


class VaultFailure(Exception):
    def __init__(self, code: str, **fields: Any) -> None:
        message, remedy = FAILURES[code]
        super().__init__(message.format(**fields))
        self.code, self.message, self.remedy = code, message.format(**fields), remedy


class _Sts(Protocol):
    def assume_role(self, **kwargs: Any) -> dict[str, Any]: ...


class AwsSecretsManager:
    def __init__(
        self,
        vault_id: str,
        sts: _Sts,
        client_for: Any,
        *,
        role_arn: str,
        external_id: str,
        region: str,
        lease_seconds: int = 3600,
    ) -> None:
        self.id = vault_id
        self._sts, self._client_for = sts, client_for
        self._role_arn, self._external_id = role_arn, external_id
        self._region, self._lease = region, lease_seconds

    def _assume(self, session_name: str, **extra: Any) -> dict[str, Any]:
        try:
            return self._sts.assume_role(
                RoleArn=self._role_arn,
                RoleSessionName=session_name[:64],
                ExternalId=self._external_id,
                **extra,
            )
        except Exception as error:  # 11 §5.8: assumption is the vault-level fact
            raise VaultFailure("vault.aws.assume_denied", role_arn=self._role_arn) from error

    async def probe(self, ref: str) -> Probe:
        """`DescribeSecret` under the assumed role: no value, CloudTrail-logged.
        It proves the secret exists and we may read its metadata; it does not
        prove `GetSecretValue` would succeed, and the detail says so."""
        assumed = self._assume(f"harness-probe-{self.id}")
        try:
            described = self._client_for(assumed["Credentials"]).describe_secret(SecretId=ref)
        except Exception as error:
            code = _DESCRIBE_ERRORS.get(getattr(error, "code", ""), "vault.aws.describe_denied")
            return {"ready": False, "evidence": "declared", "detail": _detail(code, ref, self)}
        if described.get("DeletedDate"):
            detail = _detail("vault.aws.scheduled_deletion", ref, self)
            return {"ready": False, "evidence": "declared", "detail": detail}
        return {
            "ready": True,
            "evidence": "verified",
            "detail": (
                f"last changed {described.get('LastChangedDate')}, "
                f"rotation enabled {described.get('RotationEnabled')}; "
                "metadata only — a read is not proven until first use"
            ),
        }

    async def resolve(
        self, ref: str, session: SessionContext, mint: dict[str, Any] | None
    ) -> Minted:
        options = mint or {}
        seconds = int(options.get("duration_seconds", 3600))
        assumed = self._assume(
            f"harness-{session['session']}",
            DurationSeconds=seconds,
            Tags=[
                {"Key": "harness:person", "Value": session["person"]},
                {"Key": "harness:session", "Value": session["session"]},
                {"Key": "harness:group", "Value": session["group"]},
            ],
            # The intersection with the role's own policy is what the session
            # gets [AW1]: this one secret, read only.
            Policy=(
                '{"Version":"2012-10-17","Statement":[{"Effect":"Allow",'
                '"Action":"secretsmanager:GetSecretValue","Resource":"' + ref + '"}]}'
            ),
        )
        fetched = self._client_for(assumed["Credentials"]).get_secret_value(SecretId=ref)
        lease = datetime.now(UTC) + timedelta(seconds=min(seconds, self._lease))
        expiry = assumed["Credentials"].get("Expiration")
        return {
            "value": fetched["SecretString"],
            "kind": "stored",
            "expires_at": min(expiry, lease).isoformat() if expiry else lease.isoformat(),
            "evidence": "verified",
            "version": fetched.get("VersionId"),
        }

    async def revoke(self, minted: Minted) -> None:
        """STS sessions cannot be revoked early and the value is not one of
        ours to revoke. Revocation of *use* is the proxy ceasing to inject."""
        return None


def _detail(code: str, ref: str, vault: AwsSecretsManager) -> str:
    return FAILURES[code][0].format(ref=ref, region=vault._region, role_arn=vault._role_arn)
