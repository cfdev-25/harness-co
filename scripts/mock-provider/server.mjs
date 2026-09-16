import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 8401;
const MARKER = "MOCK_PROVIDER_OK";

function sendJson(response, statusCode, body) {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
}

function messageText(content) {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("");
	}

	return "";
}

function lastUserMessage(messages) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			return messageText(messages[index].content);
		}
	}
	return "";
}

function hasToolResult(messages) {
	return messages.some((message) => message?.role === "tool");
}

function completionChunk(model, choices, usage) {
	const chunk = {
		id: "chatcmpl-harness-mock",
		object: "chat.completion.chunk",
		created: 0,
		model,
		choices,
	};
	if (usage) {
		chunk.usage = usage;
	}
	return chunk;
}

function streamCompletion(response, model, content, includeUsage) {
	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});

	const writeEvent = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`);
	writeEvent(
		completionChunk(model, [
			{ index: 0, delta: { role: "assistant" }, finish_reason: null },
		]),
	);
	writeEvent(
		completionChunk(model, [
			{ index: 0, delta: { content }, finish_reason: null },
		]),
	);
	writeEvent(
		completionChunk(model, [
			{ index: 0, delta: {}, finish_reason: "stop" },
		]),
	);

	if (includeUsage) {
		writeEvent(
			completionChunk(model, [], {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			}),
		);
	}

	response.end("data: [DONE]\n\n");
}

function streamReadToolCall(response, model) {
	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const writeEvent = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`);
	writeEvent(
		completionChunk(model, [
			{
				index: 0,
				delta: {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call_harness_read",
							type: "function",
							function: { name: "read", arguments: '{"path":"AGENTS.md"}' },
						},
					],
				},
				finish_reason: null,
			},
		]),
	);
	writeEvent(completionChunk(model, [{ index: 0, delta: {}, finish_reason: "tool_calls" }]));
	response.end("data: [DONE]\n\n");
}

const server = http.createServer((request, response) => {
	if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
		sendJson(response, 404, {
			error: {
				message: "Not found",
				type: "invalid_request_error",
			},
		});
		return;
	}

	let rawBody = "";
	request.setEncoding("utf8");
	request.on("data", (chunk) => {
		rawBody += chunk;
	});
	request.on("end", () => {
		let body;
		try {
			body = JSON.parse(rawBody);
		} catch {
			sendJson(response, 400, {
				error: {
					message: "Request body must be valid JSON",
					type: "invalid_request_error",
				},
			});
			return;
		}

		if (!Array.isArray(body.messages)) {
			sendJson(response, 400, {
				error: {
					message: "messages must be an array",
					type: "invalid_request_error",
				},
			});
			return;
		}

		const model = typeof body.model === "string" ? body.model : "mock-model";
		const content = `${MARKER}: ${lastUserMessage(body.messages)}`;

		if (body.stream === true) {
			if (!hasToolResult(body.messages) && /\bread\b/i.test(lastUserMessage(body.messages))) {
				streamReadToolCall(response, model);
				return;
			}
			streamCompletion(
				response,
				model,
				content,
				body.stream_options?.include_usage === true,
			);
			return;
		}

		sendJson(response, 200, {
			id: "chatcmpl-harness-mock",
			object: "chat.completion",
			created: 0,
			model,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
		});
	});
});

server.listen(PORT, HOST, () => {
	console.log(`Mock OpenAI provider listening on http://${HOST}:${PORT}/v1`);
});
