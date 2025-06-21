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

  const handleSelectForm = (formId: string) => {
    const formTemplate = supportedFormsData[formId]
    if (!formTemplate) return

    resetChatAndState()
    const newForm = JSON.parse(JSON.stringify(formTemplate))
    setActiveForm(newForm)
    setSelectedPdfFile(null)
    setActiveMode("form")
    setCurrentFieldIndex(0)

    const firstQuestion = newForm.fields[0].question
    const initialPrompt = `I've selected the "${newForm.name}". Please start by asking me the first question for this form: "${firstQuestion}"`
    sendMessage(initialPrompt, "form")
  }

  const handlePdfFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      resetChatAndState()
      setSelectedPdfFile(file)
      setActiveForm(null)
      setActiveMode("pdf")

      const initialPrompt = `I've uploaded a PDF named "${file.name}". Please acknowledge this and let me know you're ready for my questions about it.`
      sendMessage(initialPrompt, "pdf", file)
    }
  }

  const handleSubmit = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault()
    if (!input.trim()) return

    const userAnswer = input
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: userAnswer }
    setMessages((prev) => [...prev, userMessage])
    setInput("")

    if (activeMode === "form" && activeForm) {
      const updatedFields = [...activeForm.fields]
      updatedFields[currentFieldIndex].value = userAnswer
      setActiveForm({ ...activeForm, fields: updatedFields })

      const nextIndex = currentFieldIndex + 1
      if (nextIndex < activeForm.fields.length) {
        setCurrentFieldIndex(nextIndex)
        const nextQuestion = activeForm.fields[nextIndex].question
        sendMessage(
          `My answer was "${userAnswer}". For the "${activeForm.name}", please ask the next question: "${nextQuestion}"`,
          "form",
        )
      } else {
        sendMessage(
          `My final answer for the "${activeForm.name}" was "${userAnswer}". The form is complete. Please confirm and provide a summary.`,
          "form",
        )
      }
    } else if (activeMode === "pdf" && selectedPdfFile) {
      sendMessage(
        `Regarding the PDF "${selectedPdfFile.name}", my question is: "${userAnswer}"`,
        "pdf",
        selectedPdfFile,
      )
    } else {
      sendMessage(userAnswer, "none")
    }
  }

  const sendMessage = async (prompt: string, mode: ActiveMode, file?: File) => {
    setIsLoading(true)
    const assistantMessageId = Date.now().toString() + "-assistant"
    setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: "" }])

    let apiEndpoint = "/api/chat"
    let requestBody: any
    let headers: HeadersInit = { "Content-Type": "application/json" }

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
        const rawDecodedChunk = decoder.decode(value, { stream: true })
        // console.log("Raw Decoded Stream Chunk:", JSON.stringify(rawDecodedChunk)); // For verbose debugging
        if (done) break
        accumulatedChunk += decoder.decode(value, { stream: true })
        const boundary = accumulatedChunk.lastIndexOf("\n")
        if (boundary === -1 && !done) continue

        const processableChunk = accumulatedChunk.substring(0, boundary)
        accumulatedChunk = accumulatedChunk.substring(boundary + 1)
        const lines = processableChunk.split("\n")

        for (const line of lines) {
          if (apiEndpoint === "/api/chat" && line.startsWith("0:")) {
            try {
              const parsedContent = JSON.parse(line.substring(2))
              // console.log("Parsed Chat Stream Content:", JSON.stringify(parsedContent)); // For verbose debugging
              if (typeof parsedContent === "string" && parsedContent.trim().length > 0) {
                assistantResponseContent += parsedContent
              } else if (
                typeof parsedContent === "string" &&
                parsedContent.length > 0 &&
                assistantResponseContent.length === 0
              ) {
                // Allow initial whitespace if the message starts with it, but not if it's just empty
                assistantResponseContent += parsedContent
              }
              // If parsedContent is empty or only whitespace (and not the start of the message), we effectively skip appending it.
            } catch (err) {
              // console.error("Error parsing chat stream line:", err, line);
            }
          } else if (apiEndpoint === "/api/analyze-pdf") {
            assistantResponseContent += line + (lines.length > 1 && line ? "\n" : "")
          }
        }
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: assistantResponseContent } : msg)),
        )
      }
      if (accumulatedChunk.length > 0) {
        if (apiEndpoint === "/api/chat" && accumulatedChunk.startsWith("0:")) {
          try {
            const parsedContent = JSON.parse(accumulatedChunk.substring(2))
            // console.log("Parsed Final Chat Stream Content:", JSON.stringify(parsedContent)); // For verbose debugging
            if (typeof parsedContent === "string" && parsedContent.trim().length > 0) {
              assistantResponseContent += parsedContent
            } else if (
              typeof parsedContent === "string" &&
              parsedContent.length > 0 &&
              assistantResponseContent.length === 0
            ) {
              assistantResponseContent += parsedContent
            }
          } catch (err) {
            // console.error("Error parsing final chat stream chunk:", err, accumulatedChunk);
          }
        } else if (apiEndpoint === "/api/analyze-pdf") {
          assistantResponseContent += accumulatedChunk
        }
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: assistantResponseContent } : msg)),
        )
      }
    } catch (error) {
      console.error("Error sending message:", error)
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString() + "-error", role: "assistant", content: "Sorry, an error occurred." },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const getInputPlaceholder = () => {
    if (activeMode === "form" && activeForm) return "Type your answer for the current question..."
    if (activeMode === "pdf") return "Ask a question about the uploaded PDF..."
    return "Select a form or upload a PDF to start"
  }

  const prepareMarkdownContent = (content: string) => {
    if (typeof content !== "string") return ""

    // 1. Normalize literal "\\n" to actual "\n"
    let processedContent = content.replace(/\\n/g, "\n")

    // 2. Replace sequences of 3 or more newlines with just two newlines (paragraph break)
    processedContent = processedContent.replace(/\n{3,}/g, "\n\n")

    // 3. Convert remaining newlines to <br /> for rendering
    // Single \n becomes one <br />, \n\n becomes <br /><br />
    processedContent = processedContent.replace(/\n/g, "<br />")

    // 4. Clean up: Remove leading/trailing <br /> tags
    // Remove leading <br /> tags
    processedContent = processedContent.replace(/^(<br\s*\/?>\s*)+/, "")
    // Remove trailing <br /> tags
    processedContent = processedContent.replace(/(<br\s*\/?>\s*)+$/, "")

    // 5. Trim any final whitespace
    processedContent = processedContent.trim()

    return processedContent
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-full">
      <Card className="md:col-span-3 flex flex-col">
        <CardHeader>
          <CardTitle>Get Started</CardTitle>
          <CardDescription>Select a form or upload a PDF.</CardDescription>
        </CardHeader>
        <CardContent className="flex-grow space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-2 text-foreground">Supported Forms</h4>
            <ScrollArea className="h-48 border rounded-md p-2 bg-muted/20">
              <ul className="space-y-1">
                {Object.values(supportedFormsData).map((form) => (
                  <li key={form.id}>
                    <Button
                      variant={activeForm?.id === form.id ? "secondary" : "ghost"}
                      className="w-full justify-start text-sm h-9"
                      onClick={() => handleSelectForm(form.id)}
                    >
                      <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                      <span className="truncate">{form.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
          <div className="pt-4">
            <h4 className="text-sm font-semibold mb-2 text-foreground">Upload PDF</h4>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => pdfInputRef.current?.click()}
              disabled={isLoading}
            >
              <UploadCloud className="h-4 w-4 mr-2" />
              {selectedPdfFile ? selectedPdfFile.name : "Choose PDF File"}
            </Button>
            <input
              type="file"
              ref={pdfInputRef}
              onChange={handlePdfFileChange}
              accept="application/pdf"
              className="hidden"
            />
            {selectedPdfFile && (
              <p className="text-xs text-muted-foreground mt-1 truncate">Selected: {selectedPdfFile.name}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-6 flex flex-col h-full">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center">
            <Avatar className="w-8 h-8 mr-2 border">
              <AvatarImage src="/placeholder.svg?width=32&height=32&text=SA" alt="SocialAgent" />
              <AvatarFallback>SA</AvatarFallback>
            </Avatar>
            SocialAgent
          </CardTitle>
          <CardDescription>Your AI assistant for government forms and PDFs.</CardDescription>
        </CardHeader>
        <CardContent className="flex-grow p-0">
          <ScrollArea className="h-full p-4 md:p-6" ref={scrollAreaRef}>
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                <MessageSquare className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                <p className="text-lg font-medium">Chat with SocialAgent</p>
                <p className="text-sm">
                  {activeMode === "none"
                    ? "Select a form or upload a PDF to begin."
                    : activeMode === "form"
                      ? "The agent will guide you through the selected form."
                      : "Ask questions about the uploaded PDF."}
                </p>
              </div>
            )}
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn("flex items-end gap-2", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  {message.role === "assistant" && (
                    <Avatar className="w-8 h-8 border flex-shrink-0">
                      <AvatarImage src="/placeholder.svg?width=32&height=32&text=SA" alt="SocialAgent" />
                      <AvatarFallback>SA</AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 max-w-[80%] shadow-sm",
                      message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <ReactMarkdown
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        p: ({ node, ...props }) => <p className="mb-1 last:mb-0" {...props} />,
                        ul: ({ node, ...props }) => <ul className="list-disc list-inside pl-4" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal list-inside pl-4" {...props} />,
                      }}
                    >
                      {message.role === "assistant" ? prepareMarkdownContent(message.content) : message.content}
                    </ReactMarkdown>
                  </div>
                  {message.role === "user" && (
                    <Avatar className="w-8 h-8 border flex-shrink-0">
                      <AvatarImage src="/placeholder.svg?width=32&height=32&text=U" alt="User" />
                      <AvatarFallback>
                        <UserIcon size={16} />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter className="border-t p-3 md:p-4">
          <form onSubmit={handleSubmit} className="flex w-full items-center gap-2">
            <Input
              placeholder={getInputPlaceholder()}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading || activeMode === "none"}
              className="flex-grow"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || activeMode === "none" || !input.trim()}
              aria-label="Send message"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </form>
        </CardFooter>
      </Card>

      <div className="md:col-span-3 hidden md:flex">
        <FormStatePanel activeForm={activeForm} activePdf={selectedPdfFile} />
      </div>
    </div>
  )
}
