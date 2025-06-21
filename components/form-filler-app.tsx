"use client"

import { useState, useRef, type FormEvent, type ChangeEvent, useEffect } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Loader2, FileText, UploadCloud, MessageSquare, UserIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import { supportedFormsData, type FormData as AppFormData } from "@/lib/forms"
import FormStatePanel from "./form-state-panel"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

type ActiveMode = "form" | "pdf" | "none"

export default function FormFillerApp() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [activeForm, setActiveForm] = useState<AppFormData | null>(null)
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0)
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null)
  const [activeMode, setActiveMode] = useState<ActiveMode>("none")

  const pdfInputRef = useRef<HTMLInputElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: "smooth" })
    }
  }, [messages])

  const resetChatAndState = () => {
    setMessages([])
    setInput("")
    setIsLoading(false)
  }

  const sendMessage = async (prompt: string, mode: ActiveMode, file?: File) => {
    setIsLoading(true)
    const assistantMessageId = Date.now().toString() + "-assistant"
    setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: "" }])

    let apiEndpoint = "/api/chat"
    let headers: HeadersInit = { "Content-Type": "application/json" }
    let requestBody: BodyInit

    if (mode === "pdf" && file) {
      apiEndpoint = "/api/analyze-pdf"
      const formData = new FormData()
      formData.append("pdf", file)
      formData.append("prompt", prompt)
      requestBody = formData
      headers = {}
    } else {
      requestBody = JSON.stringify({ prompt })
    }

    try {
      const response = await fetch(apiEndpoint, { method: "POST", headers, body: requestBody })
      if (!response.ok || !response.body) throw new Error("API request failed")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantResponseContent = ""
      let accumulatedChunk = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const decoded = decoder.decode(value, { stream: true })
        accumulatedChunk += decoded
        const boundary = accumulatedChunk.lastIndexOf("\n")
        if (boundary === -1) continue

        const chunkToProcess = accumulatedChunk.slice(0, boundary)
        accumulatedChunk = accumulatedChunk.slice(boundary + 1)
        const lines = chunkToProcess.split("\n")

        for (const line of lines) {
          if (apiEndpoint === "/api/chat" && line.startsWith("0:")) {
            try {
              const parsed = JSON.parse(line.slice(2))
              if (typeof parsed === "string" && parsed.trim()) {
                assistantResponseContent += parsed
              }
            } catch {}
          } else if (apiEndpoint === "/api/analyze-pdf") {
            assistantResponseContent += line + (lines.length > 1 && line ? "\n" : "")
          }
        }

        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: assistantResponseContent } : msg)),
        )
      }

      if (accumulatedChunk && apiEndpoint === "/api/chat" && accumulatedChunk.startsWith("0:")) {
        try {
          const parsed = JSON.parse(accumulatedChunk.slice(2))
          if (typeof parsed === "string" && parsed.trim()) {
            assistantResponseContent += parsed
          }
        } catch {}
      } else if (apiEndpoint === "/api/analyze-pdf") {
        assistantResponseContent += accumulatedChunk
      }

      setMessages((prev) =>
        prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: assistantResponseContent } : msg)),
      )
    } catch (error) {
      console.error("Error sending message:", error)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + "-error",
          role: "assistant",
          content: "Sorry, an error occurred.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  // (UI rendering remains unchanged)
  return <div>{/* App UI here */}</div>
}
