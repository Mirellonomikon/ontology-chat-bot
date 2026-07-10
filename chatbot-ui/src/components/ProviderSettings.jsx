import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  Flex,
  Input,
  Slider,
  Spinner,
  Text,
} from '@chakra-ui/react';
import { CheckIcon, ExternalLinkIcon, KeyRoundIcon, SlidersHorizontalIcon } from 'lucide-react';
import { getProviderSettings, saveProviderSettings } from '../api/client';
import { usePromptSettings } from '../hooks/usePromptSettings';

function SliderRow({ label, hint, value, min, max, step, onChange }) {
  const [localVal, setLocalVal] = useState(String(value));

  // Keep local text in sync when parent value changes
  useEffect(() => setLocalVal(String(value)), [value]);

  function commitNumber(raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n)) {
      const clamped = Math.min(max, Math.max(min, n));
      setLocalVal(String(clamped));
      onChange(clamped);
    } else {
      setLocalVal(String(value));
    }
  }

  return (
    <Box mb={4}>
      <Flex justify="space-between" align="center" mb={1}>
        <Box>
          <Text fontSize="xs" color="fg" fontWeight="medium">{label}</Text>
          {hint && <Text fontSize="10px" color="fg.subtle">{hint}</Text>}
        </Box>
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={(e) => commitNumber(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitNumber(e.target.value)}
          size="xs"
          w="72px"
          textAlign="right"
        />
      </Flex>
      <Slider.Root
        size="sm"
        colorPalette="blue"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(e) => { onChange(e.value[0]); setLocalVal(String(e.value[0])); }}
        cursor="pointer"
      >
        <Slider.Control>
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumb index={0}>
            <Slider.HiddenInput />
          </Slider.Thumb>
        </Slider.Control>
      </Slider.Root>
      <Flex justify="space-between" mt={0.5}>
        <Text fontSize="10px" color="fg.subtle">{min}</Text>
        <Text fontSize="10px" color="fg.subtle">{max.toLocaleString()}</Text>
      </Flex>
    </Box>
  );
}

function ProviderRow({ label, name, keyHint, keySet, value, onChange, link, linkLabel, note }) {
  const [show, setShow] = useState(false);

  return (
    <Box
      border="1px solid"
      borderColor="border.muted"
      borderRadius="xl"
      p={4}
      mb={3}
    >
      <Flex align="center" gap={2} mb={2}>
        <KeyRoundIcon size={14} />
        <Text fontWeight="semibold" fontSize="sm" color="fg">
          {label}
        </Text>
        {keySet && (
          <Flex
            align="center"
            gap={1}
            ml="auto"
            bg="green.subtle"
            color="green.600"
            _dark={{ color: 'green.300' }}
            px={2}
            py={0.5}
            borderRadius="full"
            fontSize="xs"
          >
            <CheckIcon size={10} />
            Configured
          </Flex>
        )}
      </Flex>

      {note && (
        <Text fontSize="xs" color="fg.muted" mb={2}>
          {note}
        </Text>
      )}

      <Flex align="center" gap={2} mb={1}>
        <Input
          type={show ? 'text' : 'password'}
          placeholder={keySet ? '••••••••  (leave blank to keep current)' : 'Paste your API key…'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          size="sm"
          flex={1}
          fontFamily="mono"
          fontSize="xs"
        />
        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          onClick={() => setShow((s) => !s)}
          flexShrink={0}
        >
          {show ? 'Hide' : 'Show'}
        </Button>
      </Flex>

      {keySet && keyHint && (
        <Text fontSize="10px" color="fg.subtle" fontFamily="mono">
          Current: {keyHint}
        </Text>
      )}

      {link && (
        <Flex align="center" gap={1} mt={1}>
          <ExternalLinkIcon size={11} />
          <Text
            as="a"
            href={link}
            target="_blank"
            rel="noreferrer"
            fontSize="xs"
            color="blue.500"
            _hover={{ textDecoration: 'underline' }}
          >
            {linkLabel}
          </Text>
        </Flex>
      )}
    </Box>
  );
}

export function ProviderSettings({ trigger }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const [providers, setProviders] = useState([]);
  const [orKey, setOrKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');

  const { maxTokens, setMaxTokens, contextLength, setContextLength } = usePromptSettings();

  const successTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    setOrKey('');
    setGeminiKey('');
    getProviderSettings()
      .then((data) => setProviders(data.providers ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {};
      if (orKey.trim()) payload.openrouter_api_key = orKey.trim();
      if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
      if (Object.keys(payload).length === 0) {
        setOpen(false);
        return;
      }
      const data = await saveProviderSettings(payload);
      setProviders(data.providers ?? []);
      setOrKey('');
      setGeminiKey('');
      setSuccess(true);
      clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => {
        setSuccess(false);
        setOpen(false);
      }, 1200);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const orProvider = providers.find((p) => p.name === 'openrouter') ?? {};
  const geminiProvider = providers.find((p) => p.name === 'gemini') ?? {};

  return (
    <Dialog.Root open={open} onOpenChange={({ open: o }) => setOpen(o)} placement="center">
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content maxW="440px" borderRadius="2xl" p={0} overflow="hidden">
          {/* Header */}
          <Flex
            align="center"
            px={5}
            py={4}
            borderBottom="1px solid"
            borderColor="border.muted"
          >
            <Text fontWeight="semibold" fontSize="sm" color="fg">
              Provider Settings
            </Text>
          </Flex>

          {/* Body */}
          <Box px={5} py={4} maxH="85vh" overflowY="auto">
            {loading ? (
              <Flex justify="center" py={8}>
                <Spinner size="sm" />
              </Flex>
            ) : (
              <>
                <ProviderRow
                  label="OpenRouter"
                  name="openrouter"
                  keySet={orProvider.key_set}
                  keyHint={orProvider.key_hint}
                  value={orKey}
                  onChange={setOrKey}
                  link="https://openrouter.ai/keys"
                  linkLabel="Get your key at openrouter.ai/keys"
                  note="Unified gateway to many LLMs (GPT-4o, Claude, Gemini, etc.)."
                />

                <ProviderRow
                  label="Google Gemini (AI Studio)"
                  name="gemini"
                  keySet={geminiProvider.key_set}
                  keyHint={geminiProvider.key_hint}
                  value={geminiKey}
                  onChange={setGeminiKey}
                  link="https://aistudio.google.com/apikey"
                  linkLabel="Get your key at aistudio.google.com/apikey"
                  note="Direct access to Gemini and Gemma models via Google AI Studio."
                />

                {error && (
                  <Text fontSize="xs" color="red.500" mt={1} mb={2}>
                    {error}
                  </Text>
                )}

                {/* Generation Settings */}
                <Box
                  mt={3}
                  pt={3}
                  borderTop="1px solid"
                  borderColor="border.muted"
                >
                  <Flex align="center" gap={2} mb={3}>
                    <SlidersHorizontalIcon size={13} />
                    <Text fontWeight="semibold" fontSize="sm" color="fg">
                      Generation Settings
                    </Text>
                  </Flex>

                  <SliderRow
                    label="Max response tokens"
                    hint="How many tokens the model may generate per reply (LM Studio & OpenRouter)"
                    value={maxTokens}
                    min={128}
                    max={32768}
                    step={128}
                    onChange={setMaxTokens}
                  />

                  <SliderRow
                    label="Context length (tokens)"
                    hint="Total token budget for context sent to the model (input history + output)"
                    value={contextLength}
                    min={512}
                    max={131072}
                    step={512}
                    onChange={setContextLength}
                  />

                  {contextLength <= maxTokens && (
                    <Text fontSize="xs" color="orange.500" mt={1}>
                      ⚠ Context length must be greater than max response tokens.
                    </Text>
                  )}
                </Box>
              </>
            )}
          </Box>

          {/* Footer */}
          <Flex
            justify="flex-end"
            gap={2}
            px={5}
            py={3}
            borderTop="1px solid"
            borderColor="border.muted"
          >
            <Dialog.CloseTrigger asChild>
              <Button variant="ghost" size="sm" color="fg.muted">
                Close
              </Button>
            </Dialog.CloseTrigger>
            <Button
              size="sm"
              onClick={handleSave}
              loading={saving}
              disabled={loading || success}
              style={{ background: 'linear-gradient(135deg, #554971 0%, #8AC6D0 100%)', color: 'white' }}
            >
              {success ? '✓ Saved' : 'Save'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
