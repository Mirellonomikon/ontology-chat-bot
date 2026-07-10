import { Box, Checkbox, Flex, Text } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useColorMode } from "./ui/color-mode";
import { AVATAR_SRC } from "../constants";

const CHECKBOX_W = 24; // px reserved for checkbox + gap when in select mode

function BotAvatar() {
  return (
    <Box w="28px" h="28px" borderRadius="full" overflow="hidden" flexShrink={0}>
      <img
        src={AVATAR_SRC}
        alt="Haro"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </Box>
  );
}

function SelectCheckbox({ checked, onChange }) {
  return (
    <Box
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      w="20px"
      pt="6px"
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox.Root
        checked={checked}
        onCheckedChange={onChange}
        size="sm"
        colorPalette="blue"
        cursor="pointer"
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
      </Checkbox.Root>
    </Box>
  );
}

function makeMarkdownComponents(isDark) {
  return {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      if (!inline && match) {
        return (
          <SyntaxHighlighter
            style={isDark ? oneDark : oneLight}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: "0.5em 0", borderRadius: "8px", fontSize: "0.82em" }}
            {...props}
          >
            {String(children).replace(/\n$/, "")}
          </SyntaxHighlighter>
        );
      }
      return (
        <code
          style={{
            background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)",
            borderRadius: "4px",
            padding: "1px 5px",
            fontSize: "0.85em",
            fontFamily: "monospace",
          }}
          {...props}
        >
          {children}
        </code>
      );
    },
    p({ children }) {
      return <p style={{ margin: "0.3em 0" }}>{children}</p>;
    },
    ul({ children }) {
      return <ul style={{ paddingLeft: "1.4em", margin: "0.3em 0" }}>{children}</ul>;
    },
    ol({ children }) {
      return <ol style={{ paddingLeft: "1.4em", margin: "0.3em 0" }}>{children}</ol>;
    },
    li({ children }) {
      return <li style={{ marginBottom: "0.1em" }}>{children}</li>;
    },
    blockquote({ children }) {
      return (
        <blockquote
          style={{
            borderLeft: "3px solid #554971",
            margin: "0.4em 0",
            paddingLeft: "0.8em",
            opacity: 0.8,
          }}
        >
          {children}
        </blockquote>
      );
    },
    table({ children }) {
      return (
        <div style={{ overflowX: "auto", margin: "0.5em 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.9em", width: "100%" }}>
            {children}
          </table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th
          style={{
            border: "1px solid",
            borderColor: isDark ? "#444" : "#ccc",
            padding: "4px 10px",
            background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
          }}
        >
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td
          style={{
            border: "1px solid",
            borderColor: isDark ? "#444" : "#ccc",
            padding: "4px 10px",
          }}
        >
          {children}
        </td>
      );
    },
  };
}

function MarkdownContent({ content, isDark }) {
  const components = makeMarkdownComponents(isDark);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

export function MessageList({
  messages,
  streamingContent,
  streaming,
  onReroll,
  selectMode = false,
  selectedIndices = new Set(),
  onToggleSelect,
}) {
  const { isDark } = useColorMode();

  // Build groups, tracking which flat indices each group covers
  const groups = [];
  messages.forEach((msg, idx) => {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.role === msg.role &&
      !msg.isError &&
      !last.items[last.items.length - 1]?.isError
    ) {
      last.items.push({ content: msg.content, isError: !!msg.isError, idx });
    } else {
      groups.push({
        role: msg.role,
        items: [{ content: msg.content, isError: !!msg.isError, idx }],
      });
    }
  });

  // Index of last non-error assistant group (for reroll button)
  const lastAssistantGroupIdx = (() => {
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.role === "assistant" && !g.items.every((it) => it.isError)) return i;
    }
    return -1;
  })();

  return (
    <Flex direction="column" gap={5} maxW="900px" mx="auto" w="100%">
      {groups.map((group, gi) => {
        const groupIndices = group.items.map((it) => it.idx);
        const isGroupSelected = groupIndices.every((i) => selectedIndices.has(i));
        const isLastAssistant = !streaming && gi === lastAssistantGroupIdx;
        const isAssistant = group.role === "assistant";

        // avatar col width (28) + gap (8) = 36px; add checkbox col (20) + gap (8) = 64px in select mode
        const labelMl = isAssistant
          ? selectMode ? `${CHECKBOX_W + 8 + 28 + 8}px` : "36px"
          : undefined;

        return (
          <Box
            key={gi}
            w="100%"
            borderRadius="xl"
            transition="background 0.15s"
            bg={
              selectMode && isGroupSelected
                ? isDark ? "rgba(59,130,246,0.09)" : "rgba(59,130,246,0.07)"
                : "transparent"
            }
            py={selectMode ? 1 : 0}
            cursor={selectMode ? "pointer" : "default"}
            onClick={selectMode ? () => onToggleSelect?.(groupIndices) : undefined}
          >
            {/* Speaker label */}
            <Flex
              justify={isAssistant ? "flex-start" : "flex-end"}
              mb={0.5}
              pl={isAssistant ? labelMl : undefined}
              pr={!isAssistant && selectMode ? `${CHECKBOX_W + 8}px` : undefined}
            >
              <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                {isAssistant ? "Haro" : "You"}
              </Text>
            </Flex>

            {isAssistant ? (
              /* ── Assistant row: [checkbox?] [avatar] [bubbles] ── */
              <Flex align="flex-start" gap={2} w="100%">
                {selectMode && (
                  <SelectCheckbox
                    checked={isGroupSelected}
                    onChange={() => onToggleSelect?.(groupIndices)}
                  />
                )}
                <BotAvatar />
                <Flex direction="column" gap={1} flex={1} minW={0}>
                  {group.items.map((item, i) => {
                    const isLast = i === group.items.length - 1;
                    return (
                      <Box
                        key={i}
                        px={4}
                        py={2.5}
                        bg={item.isError ? "red.50" : "blue.100"}
                        color={item.isError ? "red.700" : "fg"}
                        borderWidth="1px"
                        borderColor={item.isError ? "red.200" : "blue.200"}
                        fontSize="sm"
                        lineHeight="relaxed"
                        wordBreak="break-word"
                        maxW={{ base: "95%", md: "85%", lg: "80%" }}
                        borderRadius="2xl"
                        borderBottomLeftRadius={isLast ? "sm" : "2xl"}
                        _dark={{
                          bg: item.isError ? "rgba(239,68,68,0.12)" : "rgba(14,165,233,0.12)",
                          color: item.isError ? "red.300" : "fg",
                          borderColor: "transparent",
                        }}
                      >
                        <MarkdownContent content={item.content} isDark={isDark} />
                      </Box>
                    );
                  })}

                  {/* Reroll button on last assistant group */}
                  {isLastAssistant && !selectMode && (
                    <Flex mt={0.5}>
                      <Box
                        as="button"
                        display="flex"
                        alignItems="center"
                        gap="4px"
                        px={2}
                        py={1}
                        borderRadius="md"
                        fontSize="11px"
                        color="fg.muted"
                        bg="transparent"
                        border="none"
                        cursor="pointer"
                        _hover={{
                          color: "fg",
                          bg: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                        }}
                        onClick={onReroll}
                        title="Edit last message and regenerate"
                      >
                        <RotateCcw size={12} />
                        Reroll
                      </Box>
                    </Flex>
                  )}
                </Flex>
              </Flex>
            ) : (
              /* ── User row: [bubbles] [checkbox?] ── */
              <Flex align="flex-start" gap={2} w="100%" justify="flex-end">
                <Flex direction="column" gap={1} align="flex-end" flex={1} minW={0}>
                  {group.items.map((item, i) => {
                    const isLast = i === group.items.length - 1;
                    return (
                      <Box
                        key={i}
                        px={4}
                        py={2.5}
                        color="white"
                        fontSize="sm"
                        lineHeight="relaxed"
                        whiteSpace="pre-wrap"
                        wordBreak="break-word"
                        maxW={{ base: "95%", md: "85%", lg: "80%" }}
                        borderRadius="2xl"
                        borderBottomRightRadius={isLast ? "sm" : "2xl"}
                        style={{
                          background: "linear-gradient(135deg, #554971 0%, #8AC6D0 100%)",
                        }}
                      >
                        {item.content}
                      </Box>
                    );
                  })}
                </Flex>
                {selectMode && (
                  <SelectCheckbox
                    checked={isGroupSelected}
                    onChange={() => onToggleSelect?.(groupIndices)}
                  />
                )}
              </Flex>
            )}
          </Box>
        );
      })}

      {(streaming || streamingContent) && (
        <Flex direction="column" align="flex-start" gap={1} w="100%">
          <Text fontSize="xs" color="fg.muted" ml="36px" mb={0.5} fontWeight="medium">
            Haro
          </Text>
          <Flex align="flex-start" gap={2} w="100%">
            <BotAvatar />
            {streamingContent ? (
              <Box
                px={4}
                py={2.5}
                bg="blue.100"
                color="fg"
                borderWidth="1px"
                borderColor="blue.200"
                fontSize="sm"
                lineHeight="relaxed"
                wordBreak="break-word"
                maxW={{ base: "95%", md: "85%", lg: "80%" }}
                flex={1}
                minW={0}
                borderRadius="2xl"
                borderBottomLeftRadius="sm"
                _dark={{ bg: "rgba(14,165,233,0.12)", borderColor: "transparent" }}
              >
                <MarkdownContent content={streamingContent} isDark={isDark} />
                <Box as="span" opacity={0.6}>
                  |
                </Box>
              </Box>
            ) : (
              <Box
                px={4}
                py={3}
                bg="blue.100"
                borderWidth="1px"
                borderColor="blue.200"
                borderRadius="2xl"
                borderBottomLeftRadius="sm"
                _dark={{ bg: "rgba(14,165,233,0.12)", borderColor: "transparent" }}
              >
                <Text className="haro-thinking" fontSize="sm" color="fg.muted">
                  Haro is thinking...
                </Text>
              </Box>
            )}
          </Flex>
        </Flex>
      )}
    </Flex>
  );
}
