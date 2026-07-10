import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  Flex,
  Spinner,
  Switch,
  Text,
  Textarea,
} from '@chakra-ui/react';
import { MessageSquareText } from 'lucide-react';
import { getSystemPrompt } from '../api/client';
import { usePromptSettings } from '../hooks/usePromptSettings';

export function CustomPrompt({ trigger }) {
  const [open, setOpen] = useState(false);
  const [haroPromptText, setHaroPromptText] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);

  const {
    customEnabled,
    customText,
    haroEnabled,
    setCustomEnabled,
    setCustomText,
    setHaroEnabled,
  } = usePromptSettings();

  // A custom prompt overrides the persona — Haro is disabled while it's active.
  const customActive = customEnabled && customText.trim().length > 0;

  useEffect(() => {
    if (!open || haroPromptText) return;
    setPromptLoading(true);
    getSystemPrompt()
      .then((data) => setHaroPromptText(data.text ?? ''))
      .catch(() => setHaroPromptText('(failed to load)'))
      .finally(() => setPromptLoading(false));
  }, [open, haroPromptText]);

  return (
    <Dialog.Root open={open} onOpenChange={({ open: o }) => setOpen(o)} placement="center">
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content maxW="480px" borderRadius="2xl" p={0} overflow="hidden">
          {/* Header */}
          <Flex
            align="center"
            gap={2}
            px={5}
            py={4}
            borderBottom="1px solid"
            borderColor="border.muted"
          >
            <MessageSquareText size={15} />
            <Text fontWeight="semibold" fontSize="sm" color="fg">
              Prompt Settings
            </Text>
          </Flex>

          {/* Body */}
          <Box px={5} py={4}>
            {/* Custom Prompt section */}
            <Flex align="center" justify="space-between" mb={2}>
              <Box>
                <Text fontWeight="semibold" fontSize="sm" color="fg">
                  Custom Prompt
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Prepend your own system instructions to every message.
                </Text>
              </Box>
              <Switch.Root
                checked={customEnabled}
                onCheckedChange={({ checked }) => setCustomEnabled(checked)}
                size="sm"
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </Flex>

            {customEnabled && (
              <Textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="e.g. Always reply in Spanish. Be concise."
                size="sm"
                rows={4}
                mb={4}
                fontFamily="mono"
                fontSize="xs"
                resize="vertical"
              />
            )}

            {!customEnabled && <Box mb={4} />}

            {/* Divider */}
            <Box borderTop="1px solid" borderColor="border.muted" mb={4} />

            {/* Haro System Prompt section */}
            <Flex align="center" justify="space-between" mb={2}>
              <Box>
                <Text fontWeight="semibold" fontSize="sm" color="fg">
                  Haro System Prompt
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {customActive
                    ? 'Disabled while a custom prompt is active.'
                    : 'Built-in personality prompt for Haro (read-only).'}
                </Text>
              </Box>
              <Switch.Root
                checked={haroEnabled && !customActive}
                disabled={customActive}
                onCheckedChange={({ checked }) => setHaroEnabled(checked)}
                size="sm"
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </Flex>

            {promptLoading ? (
              <Flex justify="center" py={4}>
                <Spinner size="sm" />
              </Flex>
            ) : (
              <Textarea
                value={haroPromptText}
                readOnly
                size="sm"
                rows={4}
                fontFamily="mono"
                fontSize="xs"
                resize="none"
                opacity={haroEnabled && !customActive ? 1 : 0.45}
                _focus={{ outline: 'none', boxShadow: 'none' }}
              />
            )}
          </Box>

          {/* Footer */}
          <Flex
            justify="flex-end"
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
          </Flex>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
