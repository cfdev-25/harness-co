# One-off migration image for the definitions service: the plain image plus
# an archive of existing bare repositories, extracted onto the volume once,
# only when the named organisation's repository is not there yet. Deploy it
# once, verify, then redeploy the plain image. Built from the repository root
# with the archive at deploy/repos.tgz (not committed).
ARG BASE
FROM ${BASE}
ARG MARKER
ENV SEED_MARKER=${MARKER}
COPY --chown=node:node deploy/repos.tgz /seed/repos.tgz
CMD ["sh", "-c", "if [ ! -d \"/data/definitions/$SEED_MARKER\" ]; then mkdir -p /data/definitions && tar xzf /seed/repos.tgz -C /data/definitions && echo seeded; fi; exec node scripts/dev-definitions.mjs"]
