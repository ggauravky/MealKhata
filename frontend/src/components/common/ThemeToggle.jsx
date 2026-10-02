import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.jsx';
import { Button } from '../ui/button.jsx';

export function ThemeToggle({ className = '' }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 w-8 px-0 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 ${className}`}
          aria-label="Toggle theme"
          title={`Theme: ${theme}`}
        >
          {resolvedTheme === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          onClick={() => setTheme('light')}
          className="flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-500" />
            <span>Light</span>
          </span>
          {theme === 'light' && <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme('dark')}
          className="flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-indigo-400" />
            <span>Dark</span>
          </span>
          {theme === 'dark' && <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme('system')}
          className="flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-slate-400" />
            <span>System</span>
          </span>
          {theme === 'system' && <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
