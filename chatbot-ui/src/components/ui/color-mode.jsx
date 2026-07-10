import { ThemeProvider, useTheme } from 'next-themes';

export function ColorModeProvider(props) {
  return (
    <ThemeProvider
      attribute="class"
      storageKey="chatbot-theme"
      defaultTheme="system"
      disableTransitionOnChange
      {...props}
    />
  );
}

export function useColorMode() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return {
    colorMode: resolvedTheme ?? 'light',
    isDark,
    setColorMode: setTheme,
    toggleColorMode: () => setTheme(isDark ? 'light' : 'dark'),
  };
}
