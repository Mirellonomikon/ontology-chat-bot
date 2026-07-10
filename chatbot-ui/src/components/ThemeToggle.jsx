import { IconButton } from '@chakra-ui/react';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useColorMode } from './ui/color-mode';

export function ThemeToggle() {
  const { isDark, toggleColorMode } = useColorMode();
  return (
    <IconButton
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      variant="ghost"
      size="sm"
      onClick={toggleColorMode}
    >
      {isDark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </IconButton>
  );
}
