import { lettaCloud } from "@letta-ai/vercel-ai-sdk-provider"
import { streamText } from "ai"

// export const runtime = "edge" // Optional

export async function POST(req: Request) {
  try {
    const { prompt } = (await req.json()) as { prompt: string }

    if (!process.env.LETTA_AGENT_ID_SOCIAL_AGENT) {
      throw new Error("LETTA_AGENT_ID_SOCIAL_AGENT is not set.")
    }

    const result = await streamText({
      model: lettaCloud(process.env.LETTA_AGENT_ID_SOCIAL_AGENT),
      prompt: prompt,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : "Failed to process chat message."
    console.error("[Letta Chat API Error]", error)
    return new Response(JSON.stringify({ error: errMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
