import {
  Box,
  Button,
  Drawer,
  Flex,
  IconButton,
  Text,
} from '@chakra-ui/react';
import { MessageSquarePlus, MessageSquareText, Network, Settings2, Trash2, X } from 'lucide-react';
import { CustomPrompt } from './CustomPrompt';
import { KnowledgeGraph } from './KnowledgeGraph';
import { ProviderSettings } from './ProviderSettings';

function relativeDate(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export function Sidebar({ open, onClose, chats, activeChatId, onSelect, onDelete, onNew }) {
  return (
    <Drawer.Root open={open} onOpenChange={({ open: o }) => !o && onClose()} placement="start">
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content maxW="280px" bg="bg.panel" display="flex" flexDirection="column">
          <Drawer.Header borderBottom="1px solid" borderColor="border.muted" px={4} py={3}>
            <Flex align="center" justify="space-between" w="100%">
              <Text fontWeight="semibold" fontSize="sm" color="fg">
                Chat History
              </Text>
              <IconButton
                aria-label="Close sidebar"
                variant="ghost"
                size="sm"
                color="fg.muted"
                onClick={onClose}
              >
                <X size={16} />
              </IconButton>
            </Flex>
          </Drawer.Header>

          <Drawer.Body px={2} py={2} overflowY="auto" flex={1}>
            {/* New Chat button */}
            <Button
              w="full"
              size="sm"
              variant="ghost"
              justifyContent="flex-start"
              gap={2}
              mb={2}
              color="fg"
              _hover={{ bg: 'bg.muted' }}
              onClick={() => {
                onNew();
                onClose();
              }}
            >
              <MessageSquarePlus size={15} />
              New Chat
            </Button>

            {chats.length === 0 ? (
              <Text fontSize="xs" color="fg.subtle" textAlign="center" mt={6}>
                No chats yet
              </Text>
            ) : (
              <Flex direction="column" gap={0.5}>
                {chats.map((chat) => {
                  const isActive = chat.id === activeChatId;
                  return (
                    <Flex
                      key={chat.id}
                      align="center"
                      gap={1}
                      borderRadius="md"
                      px={2}
                      py={1.5}
                      cursor="pointer"
                      bg={isActive ? 'blue.subtle' : 'transparent'}
                      _hover={{ bg: isActive ? 'blue.subtle' : 'bg.muted' }}
                      _dark={{
                        bg: isActive ? 'whiteAlpha.100' : 'transparent',
                        _hover: { bg: isActive ? 'whiteAlpha.150' : 'whiteAlpha.50' },
                      }}
                      onClick={() => {
                        onSelect(chat.id);
                        onClose();
                      }}
                      role="button"
                    >
                      <Box flex="1" minW={0}>
                        <Text
                          fontSize="xs"
                          fontWeight={isActive ? 'semibold' : 'normal'}
                          color={isActive ? 'blue.600' : 'fg'}
                          _dark={{ color: isActive ? 'blue.300' : 'fg' }}
                          lineClamp={1}
                          title={chat.title}
                        >
                          {chat.title}
                        </Text>
                        <Text fontSize="10px" color="fg.subtle">
                          {relativeDate(chat.updated_at)}
                        </Text>
                      </Box>
                      <IconButton
                        aria-label="Delete chat"
                        variant="ghost"
                        size="2xs"
                        color="fg.muted"
                        flexShrink={0}
                        _hover={{ color: 'red.500', bg: 'red.subtle' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(chat.id);
                        }}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </Flex>
                  );
                })}
              </Flex>
            )}
          </Drawer.Body>

          {/* Footer: settings */}
          <Box borderTop="1px solid" borderColor="border.muted" px={2} py={2}>
            <ProviderSettings
              trigger={
                <Button
                  w="full"
                  size="sm"
                  variant="ghost"
                  justifyContent="flex-start"
                  gap={2}
                  color="fg.muted"
                  _hover={{ bg: 'bg.muted', color: 'fg' }}
                >
                  <Settings2 size={14} />
                  Provider Settings
                </Button>
              }
            />
            <CustomPrompt
              trigger={
                <Button
                  w="full"
                  size="sm"
                  variant="ghost"
                  justifyContent="flex-start"
                  gap={2}
                  mt={0.5}
                  color="fg.muted"
                  _hover={{ bg: 'bg.muted', color: 'fg' }}
                >
                  <MessageSquareText size={14} />
                  Prompt Settings
                </Button>
              }
            />
            <KnowledgeGraph
              trigger={
                <Button
                  w="full"
                  size="sm"
                  variant="ghost"
                  justifyContent="flex-start"
                  gap={2}
                  mt={0.5}
                  color="fg.muted"
                  _hover={{ bg: 'bg.muted', color: 'fg' }}
                >
                  <Network size={14} />
                  Knowledge Graph
                </Button>
              }
            />
          </Box>
        </Drawer.Content>
      </Drawer.Positioner>
    </Drawer.Root>
  );
}
