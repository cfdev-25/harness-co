# Mock OpenAI Provider

Run the dependency-free server with Node:

```bash
node scripts/mock-provider/server.mjs
```

It listens on `http://127.0.0.1:8401` and returns `MOCK_PROVIDER_OK` followed by the last user message.

Test a non-streaming response:

```bash
curl http://127.0.0.1:8401/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"mock-model","messages":[{"role":"user","content":"hello"}]}'
```

Test an SSE response:

```bash
curl -N http://127.0.0.1:8401/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"mock-model","stream":true,"messages":[{"role":"user","content":"hello"}]}'
```
