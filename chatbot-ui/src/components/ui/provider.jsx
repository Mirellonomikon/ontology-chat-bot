import { ChakraProvider } from '@chakra-ui/react';
import { ColorModeProvider } from './color-mode';
import { PromptSettingsProvider } from '../../hooks/usePromptSettings';
import { system } from '../../theme/system';

export function Provider({ children }) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider>
        <PromptSettingsProvider>{children}</PromptSettingsProvider>
      </ColorModeProvider>
    </ChakraProvider>
  );
}
