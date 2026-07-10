import { useRef, useState } from 'react';
import { Box, Flex, IconButton, Text, Textarea } from '@chakra-ui/react';
import { DatabaseIcon, PaperclipIcon, SendHorizonalIcon, SquareIcon, XIcon } from 'lucide-react';

const ACCEPTED_TYPES = '.csv,.xlsx,.xls,.json,.tsv,.parquet,.ttl,.turtle';

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  streaming,
  useKg,
  onToggleKg,
  onUpload,
  uploading,
  uploadFeedback,
  kgDatasets = [],
  onDeleteDataset,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [focused, setFocused] = useState(false);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  }

  function handleChange(e) {
    onChange(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 140) + 'px';
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    // Reset so the same file can be re-uploaded
    e.target.value = '';
  }

  const canSend = !disabled && value.trim();
  const buttonActive = streaming || canSend;

  return (
    <Box
      px={5}
      py={4}
      borderTop="1px solid"
      borderColor="border.muted"
      bg="bg.panel"
      flexShrink={0}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Main input row */}
      <Flex
        align="center"
        gap={2}
        px={3}
        py={2.5}
        bg="bg.canvas"
        borderRadius="2xl"
        border="2px solid"
        borderColor={focused ? 'blue.500' : 'border.muted'}
        transition="border-color 0.15s"
        _dark={{ borderColor: focused ? 'blue.400' : 'border.muted' }}
        maxW="900px"
        mx="auto"
      >
        {/* Upload button */}
        <IconButton
          aria-label="Attach file to knowledge graph"
          title="Upload file to knowledge graph (CSV, Excel, JSON, TSV, Parquet, Turtle RDF)"
          variant="plain"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          boxSize="32px"
          minW="32px"
          borderRadius="full"
          flexShrink={0}
          color="fg.muted"
          _hover={{ color: 'fg' }}
        >
          <PaperclipIcon size={16} />
        </IconButton>

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Message..."
          rows={1}
          disabled={disabled}
          flex={1}
          resize="none"
          border="none"
          bg="transparent"
          color="inherit"
          fontSize="14px"
          lineHeight="1.6"
          fontFamily="inherit"
          px={0}
          py={0}
          minH="unset"
          maxH="140px"
          overflowY="auto"
          opacity={disabled ? 0.5 : 1}
          _focus={{ boxShadow: 'none', borderColor: 'transparent' }}
          _focusVisible={{ boxShadow: 'none', borderColor: 'transparent', outline: 'none' }}
        />

        <IconButton
          aria-label={streaming ? 'Stop' : 'Send'}
          onClick={streaming ? onStop : onSend}
          disabled={!streaming && !canSend}
          variant="plain"
          boxSize="36px"
          minW="36px"
          borderRadius="full"
          flexShrink={0}
          color={buttonActive ? 'white' : 'fg.muted'}
          opacity={!streaming && !canSend ? 0.45 : 1}
          transition="opacity 0.15s, transform 0.1s"
          _hover={buttonActive ? { transform: 'scale(1.08)' } : undefined}
          _active={buttonActive ? { transform: 'scale(0.94)' } : undefined}
          style={{
            background: buttonActive
              ? 'linear-gradient(135deg, #554971 0%, #8AC6D0 100%)'
              : 'var(--chakra-colors-bg-muted, #e5e7eb)',
          }}
        >
          {streaming ? <SquareIcon size={14} /> : <SendHorizonalIcon size={14} />}
        </IconButton>
      </Flex>

      {/* Toolbar row: feedback left, KG toggle right */}
      <Flex
        maxW="900px"
        mx="auto"
        mt={1.5}
        px={1}
        align="center"
        justify="space-between"
        minH="18px"
      >
        {/* Upload feedback */}
        <Text fontSize="xs" color={uploadFeedback?.error ? 'red.500' : 'green.500'}>
          {uploading ? 'Uploading…' : (uploadFeedback?.message ?? '')}
        </Text>

        {/* KG toggle */}
        <Flex
          as="button"
          align="center"
          gap={1.5}
          cursor="pointer"
          onClick={onToggleKg}
          aria-label={useKg ? 'Disable ontology' : 'Enable ontology'}
          title={useKg ? 'Ontology ON – responses are grounded in uploaded data' : 'Ontology OFF – click to enable'}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 4px',
            borderRadius: 6,
          }}
          _hover={{ opacity: 0.75 }}
        >
          <DatabaseIcon
            size={13}
            style={{ color: useKg ? 'var(--chakra-colors-brand-accent, #554971)' : 'var(--chakra-colors-fg-muted, #9ca3af)', flexShrink: 0 }}
          />
          <Text fontSize="xs" color={useKg ? 'brand.accent' : 'fg.muted'} fontWeight={useKg ? 'medium' : 'normal'}>
            Ontology
          </Text>
          {/* Pill toggle */}
          <Box
            w="28px"
            h="16px"
            borderRadius="full"
            bg={useKg ? 'brand.accent' : 'bg.muted'}
            position="relative"
            transition="background 0.2s"
            flexShrink={0}
          >
            <Box
              position="absolute"
              top="2px"
              left={useKg ? '14px' : '2px'}
              w="12px"
              h="12px"
              borderRadius="full"
              bg="white"
              boxShadow="sm"
              transition="left 0.2s"
            />
          </Box>
        </Flex>
      </Flex>

      {/* Loaded datasets row */}
      {kgDatasets.length > 0 && (
        <Flex
          maxW="900px"
          mx="auto"
          mt={1}
          px={1}
          gap={1.5}
          flexWrap="wrap"
        >
          {kgDatasets.map((name) => (
            <Flex
              key={name}
              align="center"
              gap={1}
              px={1.5}
              py={0.5}
              borderRadius="md"
              bg="bg.muted"
              border="1px solid"
              borderColor="border.muted"
              style={{ maxWidth: 200 }}
            >
              <Text
                fontSize="xs"
                color="fg.muted"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={name}
              >
                {name}
              </Text>
              <IconButton
                aria-label={`Remove dataset ${name}`}
                onClick={() => onDeleteDataset?.(name)}
                variant="plain"
                boxSize="auto"
                minW="auto"
                h="auto"
                p={0}
                flexShrink={0}
                color="fg.muted"
                _hover={{ color: 'fg' }}
              >
                <XIcon size={11} />
              </IconButton>
            </Flex>
          ))}
        </Flex>
      )}
    </Box>
  );
}
