import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { Menu, Trash2 } from "lucide-react";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { ModelSelect } from "./components/ModelSelect";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { streamChat, getSystemPrompt, uploadKnowledgeFile, getKgSchema, deleteKgDataset } from "./api/client";
import { useModels } from "./hooks/useModels";
import { useChats } from "./hooks/useChats";
import { usePromptSettings } from "./hooks/usePromptSettings";
import { AVATAR_SRC } from "./constants";

function App() {
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [haroPromptText, setHaroPromptText] = useState("");

  // Knowledge-graph state
  const [useKg, setUseKg] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null); // { message, error }
  const [kgDatasets, setKgDatasets] = useState([]); // list of dataset name strings

  // Multi-select delete state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  // track the active chat id during a session (separate from useChats so we can
  // react to changes without a circular hook dependency)
  const activeChatIdRef = useRef(null);

  const stopRef = useRef(false);
  const messagesEndRef = useRef(null);
  const { models, loading: modelsLoading } = useModels();
  const { chats, activeChatId, justCreatedId, startChat, persistMessages, openChat, selectChat, removeChat, newChat } =
    useChats();
  const { customEnabled, customText, haroEnabled, maxTokens, contextLength } = usePromptSettings();

  // Fetch the Haro system prompt text once on mount
  useEffect(() => {
    getSystemPrompt()
      .then((data) => setHaroPromptText(data.text ?? ""))
      .catch(() => {});
  }, []);

  const loadKgDatasets = useCallback(async () => {
    try {
      const schema = await getKgSchema();
      const EX = "http://chatbot.kg/data#";
      const names = (schema.datasets ?? []).map((uri) =>
        uri.startsWith(EX) ? uri.slice(EX.length) : uri
      );
      setKgDatasets(names);
    } catch {
      // kg-service may not be running; silently ignore
    }
  }, []);

  useEffect(() => { loadKgDatasets(); }, [loadKgDatasets]);

  // Keep the ref in sync with the hook's value
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // When a chat is selected via the sidebar (or on first mount), load its messages.
  // Skip the reload for a freshly created chat: messages are already in local state
  // and the DB has no messages yet (they're persisted only after the first reply).
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    if (activeChatId === justCreatedId) return;
    selectChat(activeChatId).then((chat) => {
      if (!chat) return;
      setMessages(chat.messages ?? []);
      if (chat.model && chat.provider) {
        setSelectedModel(`${chat.provider}::${chat.model}`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, justCreatedId]);

  // Once models finish loading, validate the current selection.
  // If the stored model (e.g. from chat history) isn't in the available list,
  // fall back to the first available model or clear the selection.
  useEffect(() => {
    if (modelsLoading) return;
    if (!selectedModel) {
      if (models.length > 0) setSelectedModel(`${models[0].provider}::${models[0].id}`);
      return;
    }
    const isAvailable = models.some((m) => `${m.provider}::${m.id}` === selectedModel);
    if (!isAvailable) {
      setSelectedModel(models.length > 0 ? `${models[0].provider}::${models[0].id}` : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, modelsLoading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || !selectedModel) return;

    const [provider, ...modelParts] = selectedModel.split("::");
    const model = modelParts.join("::");

    const userMessage = { role: "user", content: trimmed };
    const displayHistory = [...messages, userMessage];

    // Build system messages from active prompt settings (never shown in chat).
    // A custom prompt takes over the persona: when it's active, Haro is disabled.
    const systemMessages = [];
    const useCustom = customEnabled && customText.trim();
    if (useCustom) {
      systemMessages.push({ role: "system", content: customText.trim() });
    } else if (haroEnabled && haroPromptText) {
      systemMessages.push({ role: "system", content: haroPromptText });
    }

    setMessages(displayHistory);
    setInput("");
    setStreaming(true);
    setStreamingContent("");
    stopRef.current = false;

    // Create chat record on first message
    let chatId = activeChatIdRef.current;
    if (!chatId) {
      const chat = await startChat(trimmed, model, provider);
      chatId = chat?.id ?? null;
      activeChatIdRef.current = chatId;
    }

    // API receives system messages prepended; display messages do not include them.
    // Backend will truncate to the configured context_length in tokens.
    const apiMessages = [...systemMessages, ...displayHistory];

    let accumulated = "";
    try {
      for await (const token of streamChat({ provider, model, messages: apiMessages, useKg, maxTokens, contextLength })) {
        if (stopRef.current) break;
        accumulated += token;
        setStreamingContent(accumulated);
      }
    } catch (err) {
      // Show error as a Haro bubble — not persisted to DB
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${err.message}`, isError: true },
      ]);
    } finally {
      setStreaming(false);
      setStreamingContent("");
      if (accumulated) {
        const finalMessages = [...displayHistory, { role: "assistant", content: accumulated }];
        setMessages(finalMessages);
        // Persist after each reply
        persistMessages(chatId, finalMessages, model, provider);
      }
    }
  }, [input, streaming, selectedModel, messages, haroEnabled, haroPromptText, customEnabled, customText, useKg, maxTokens, contextLength, startChat, persistMessages]);

  const handleUpload = useCallback(async (file) => {
    setUploading(true);
    setUploadFeedback(null);
    try {
      const [provider, ...modelParts] = selectedModel.split("::");
      const model = modelParts.join("::");
      const result = await uploadKnowledgeFile(file, provider, model);
      const sem = result.semantics || {};
      let extra = "";
      if (sem.method === "llm" && sem.class) {
        const parts = [sem.subclass_of ? `${sem.class} ⊂ ${sem.subclass_of}` : sem.class];
        if (sem.properties?.length) parts.push(`relations: ${sem.properties.join(", ")}`);
        extra = ` · ${parts.join("; ")}`;
      }
      setUploadFeedback({
        message: `✓ ${result.file}: ${result.rows} rows, ${result.triples_stored} triples${extra}`,
        error: false,
      });
      await loadKgDatasets();
    } catch (err) {
      setUploadFeedback({ message: `✗ ${err.message}`, error: true });
    } finally {
      setUploading(false);
    }
    setTimeout(() => setUploadFeedback(null), 8000);
  }, [selectedModel, loadKgDatasets]);

  const handleDeleteDataset = useCallback(async (name) => {
    try {
      await deleteKgDataset(name);
      await loadKgDatasets();
    } catch {
      // silently ignore; list will re-sync on next load
    }
  }, [loadKgDatasets]);

  const handleReroll = useCallback(() => {
    const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const lastUserContent = messages[lastUserIdx].content;
    const trimmedMessages = messages.slice(0, lastUserIdx);
    setMessages(trimmedMessages);
    setInput(lastUserContent);
    if (activeChatIdRef.current) {
      const [provider, ...modelParts] = selectedModel.split("::");
      persistMessages(activeChatIdRef.current, trimmedMessages, modelParts.join("::"), provider);
    }
  }, [messages, selectedModel, persistMessages]);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedIndices(new Set());
      return !prev;
    });
  }, []);

  const handleToggleSelect = useCallback((indices) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      const allSelected = indices.every((i) => next.has(i));
      if (allSelected) indices.forEach((i) => next.delete(i));
      else indices.forEach((i) => next.add(i));
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const remaining = messages.filter((_, i) => !selectedIndices.has(i));
    setMessages(remaining);
    setSelectedIndices(new Set());
    setSelectMode(false);
    if (activeChatIdRef.current) {
      const [provider, ...modelParts] = selectedModel.split("::");
      persistMessages(activeChatIdRef.current, remaining, modelParts.join("::"), provider);
    }
  }, [messages, selectedIndices, selectedModel, persistMessages]);

  const handleNewChat = useCallback(() => {
    newChat();
    setMessages([]);
    setInput("");
    setStreamingContent("");
  }, [newChat]);

  const currentModel = selectedModel ? selectedModel.split("::").slice(1).join("::") : "";

  return (
    <Flex direction="column" h="100svh" bg="bg.canvas" overflow="hidden">
      {/* Sidebar Drawer */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        chats={chats}
        activeChatId={activeChatId}
        onSelect={openChat}
        onDelete={removeChat}
        onNew={handleNewChat}
      />

      {/* Header — position+zIndex ensure the model dropdown always renders above the message scroll area */}
      <Box
        as="header"
        px={4}
        py={3}
        borderBottom="1px solid"
        borderColor="border.muted"
        bg="bg.panel"
        flexShrink={0}
        position="relative"
        zIndex={10}
      >
        <HStack gap={3} align="center">
          {/* Hamburger */}
          <IconButton
            aria-label="Open chat history"
            variant="ghost"
            size="sm"
            color="fg.muted"
            flexShrink={0}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={18} />
          </IconButton>

          {/* Avatar */}
          <Box
            as="img"
            src={AVATAR_SRC}
            w="36px"
            h="36px"
            borderRadius="full"
            flexShrink={0}
            alt="Chatbot avatar"
            style={{ objectFit: "cover" }}
          />

          <Box flex="1" minW={0}>
            <Text fontWeight="semibold" fontSize="sm" color="fg">
              Haro
            </Text>
            <HStack gap={1} align="center">
              <Box
                as="span"
                w="7px"
                h="7px"
                borderRadius="full"
                flexShrink={0}
                bg={streaming ? "yellow.400" : "pop.500"}
                display="inline-block"
              />
              <Text fontSize="xs" color="fg.muted" truncate>
                {streaming
                  ? "Typing..."
                  : currentModel || (modelsLoading ? "Loading..." : "No model selected")}
              </Text>
            </HStack>
          </Box>

          <HStack gap={2} flexShrink={0}>
            <ModelSelect
              models={models}
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={modelsLoading || streaming}
            />
            {messages.length > 0 && !streaming && (
              <IconButton
                aria-label={selectMode ? "Exit select mode" : "Delete messages"}
                variant="ghost"
                size="sm"
                color={selectMode ? "red.400" : "fg.muted"}
                onClick={handleToggleSelectMode}
              >
                <Trash2 size={17} />
              </IconButton>
            )}
            <ThemeToggle />
          </HStack>
        </HStack>
      </Box>

      {/* Messages */}
      <Box flex="1" overflowY="auto" px={{ base: 4, md: 8 }} py={6}>
        {messages.length === 0 && !streaming ? (
          <Flex
            direction="column"
            align="center"
            justify="center"
            minH="60%"
            gap={4}
            textAlign="center"
          >
            <Box
              as="img"
              src={AVATAR_SRC}
              w="72px"
              h="72px"
              borderRadius="full"
              alt="Chatbot avatar"
              style={{ objectFit: "cover" }}
            />
            <Box>
              <Text fontWeight="bold" fontSize="lg" color="fg">
                Haro
              </Text>
              <Text fontSize="sm" color="fg.muted" mt={1}>
                {modelsLoading ? "Loading models..." : "Send a message to start the conversation"}
              </Text>
            </Box>
          </Flex>
        ) : (
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            streaming={streaming}
            onReroll={handleReroll}
            selectMode={selectMode}
            selectedIndices={selectedIndices}
            onToggleSelect={handleToggleSelect}
          />
        )}
        <div ref={messagesEndRef} />
      </Box>

      {selectMode && selectedIndices.size > 0 && (
        <Flex
          px={4}
          py={2}
          gap={2}
          align="center"
          borderTop="1px solid"
          borderColor="border.muted"
          bg="bg.panel"
          flexShrink={0}
        >
          <Text fontSize="xs" color="fg.muted" flex="1">
            {selectedIndices.size} message{selectedIndices.size !== 1 ? "s" : ""} selected
          </Text>
          <Button size="xs" variant="ghost" color="fg.muted" onClick={handleToggleSelectMode}>
            Cancel
          </Button>
          <Button
            size="xs"
            colorPalette="red"
            onClick={handleDeleteSelected}
          >
            Delete
          </Button>
        </Flex>
      )}

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onStop={() => {
          stopRef.current = true;
        }}
        disabled={!selectedModel || (!streaming && modelsLoading) || selectMode}
        streaming={streaming}
        useKg={useKg}
        onToggleKg={() => setUseKg((v) => !v)}
        onUpload={handleUpload}
        uploading={uploading}
        uploadFeedback={uploadFeedback}
        kgDatasets={kgDatasets}
        onDeleteDataset={handleDeleteDataset}
      />
    </Flex>
  );
}

export default App;
