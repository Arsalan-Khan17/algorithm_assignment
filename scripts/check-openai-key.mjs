import OpenAI from "openai";
import { createInterface } from "node:readline";

const reader = createInterface({
  input: process.stdin,
  terminal: false,
});

reader.once("line", async (line) => {
  reader.close();

  const apiKey = line.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, code: "MISSING_KEY" }));
    process.exitCode = 1;
    return;
  }

  try {
    const client = new OpenAI({ apiKey });
    const page = await client.models.list();
    const modelIds = page.data.map((model) => model.id);

    console.log(
      JSON.stringify({
        ok: true,
        authentication: "accepted",
        gpt5MiniAvailable: modelIds.includes("gpt-5-mini"),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        status: error?.status ?? null,
        code: error?.code ?? "UNKNOWN_ERROR",
        message: error?.message ?? "OpenAI request failed.",
      }),
    );
    process.exitCode = 1;
  }
});
