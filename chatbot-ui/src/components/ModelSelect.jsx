import { useState, useRef, useEffect } from 'react';
import { Box, Input, Text } from '@chakra-ui/react';

const PROVIDER_LABELS = {
  lmstudio: 'LM Studio',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini (AI Studio)',
};

export function ModelSelect({ models, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const searchRef = useRef(null);

  const selectedLabel = value
    ? (models.find((m) => `${m.provider}::${m.id}` === value)?.id ?? value)
    : 'Select a model…';

  const query = search.toLowerCase();
  const groups = models.reduce((acc, m) => {
    if (query && !m.id.toLowerCase().includes(query) && !m.provider.toLowerCase().includes(query)) return acc;
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push({ label: m.id, value: `${m.provider}::${m.id}` });
    return acc;
  }, {});

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(val) {
    onChange(val);
    setOpen(false);
    setSearch('');
  }

  return (
    <Box position="relative" ref={containerRef} minW="220px" maxW="340px" opacity={disabled ? 0.5 : 1}>
      {/* Trigger button */}
      <Box
        as="button"
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        fontSize="sm"
        px={3}
        py={1.5}
        w="100%"
        bg="bg.canvas"
        color={value ? 'fg' : 'fg.muted'}
        border="1px solid"
        borderColor={open ? 'blue.400' : 'border.muted'}
        borderRadius="md"
        cursor={disabled ? 'not-allowed' : 'pointer'}
        textAlign="left"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        outline="none"
        boxShadow={open ? '0 0 0 2px var(--chakra-colors-blue-500, #3b82f6)' : 'none'}
        _hover={disabled ? {} : { borderColor: 'blue.400' }}
        style={{ userSelect: 'none' }}
      >
        <Text as="span" truncate fontSize="sm">
          {selectedLabel}
        </Text>
        <Text as="span" ml={2} fontSize="xs" opacity={0.6}>
          {open ? '▲' : '▼'}
        </Text>
      </Box>

      {/* Dropdown panel */}
      {open && (
        <Box
          position="absolute"
          top="calc(100% + 4px)"
          left={0}
          zIndex={200}
          w="100%"
          bg="bg.canvas"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          boxShadow="lg"
          overflow="hidden"
        >
          {/* Search input */}
          <Box px={2} pt={2} pb={1}>
            <Input
              ref={searchRef}
              size="sm"
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setSearch(''))}
              borderRadius="sm"
              fontSize="sm"
            />
          </Box>

          {/* Options list */}
          <Box maxH="260px" overflowY="auto">
            {Object.keys(groups).length === 0 ? (
              <Text px={3} py={2} fontSize="sm" color="fg.muted">
                No models found
              </Text>
            ) : (
              Object.entries(groups).map(([provider, items]) => (
                <Box key={provider}>
                  <Text
                    px={3}
                    py={1}
                    fontSize="xs"
                    fontWeight="semibold"
                    color="fg.muted"
                    textTransform="uppercase"
                    letterSpacing="wide"
                    bg="bg.subtle"
                  >
                    {PROVIDER_LABELS[provider] ?? provider}
                  </Text>
                  {items.map((item) => (
                    <Box
                      key={item.value}
                      as="button"
                      type="button"
                      w="100%"
                      textAlign="left"
                      px={3}
                      py={1.5}
                      fontSize="sm"
                      color="fg"
                      bg={item.value === value ? 'blue.subtle' : 'transparent'}
                      fontWeight={item.value === value ? 'semibold' : 'normal'}
                      _hover={{ bg: 'bg.muted' }}
                      onClick={() => handleSelect(item.value)}
                      truncate
                    >
                      {item.label}
                    </Box>
                  ))}
                </Box>
              ))
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
