/** One row of 03 §5.9's local-login table. `login` and `install` are the two
    remedies the table's failures need; `network` is what `--offline` skips (D53). */
export interface LocalProbe {
	argv: string[];
	network: boolean;
	verified(result: { code: number; stdout: string }): boolean;
	login: string;
	install: string;
}

const ok = (result: { code: number }) => result.code === 0;

/** 03 §5.9's table, as data and nothing else. */
export const LOCAL_PROBES: Record<string, LocalProbe> = {
	gh: { argv: ["gh", "auth", "status", "--hostname", "github.com"], network: false, verified: ok, login: "gh auth login", install: "Install the GitHub CLI from https://cli.github.com, then run `gh auth login`." },
	aws: { argv: ["aws", "sts", "get-caller-identity", "--output", "json"], network: true, verified: (r) => ok(r) && r.stdout.includes('"Arn"'), login: "aws sso login", install: "Install the AWS CLI from https://aws.amazon.com/cli, then run `aws sso login`." },
	az: { argv: ["az", "account", "show", "-o", "json"], network: false, verified: ok, login: "az login", install: "Install the Azure CLI from https://aka.ms/azure-cli, then run `az login`." },
	gcloud: { argv: ["gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], network: false, verified: (r) => ok(r) && r.stdout.trim() !== "", login: "gcloud auth login", install: "Install the Google Cloud CLI from https://cloud.google.com/sdk, then run `gcloud auth login`." },
	supabase: { argv: ["supabase", "projects", "list", "-o", "json"], network: true, verified: ok, login: "supabase login", install: "Install the Supabase CLI from https://supabase.com/docs/guides/cli, then run `supabase login`." },
	vault: { argv: ["vault", "token", "lookup", "-format=json"], network: true, verified: ok, login: "vault login", install: "Install the Vault CLI from https://developer.hashicorp.com/vault/downloads, then run `vault login`." },
};
