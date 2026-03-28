import { useTheme } from "@/contexts/ThemeContext";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function ThemeSwitcher() {
  const { currentTheme, setTheme, themes } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-foreground/70 hover:text-foreground">
          <Palette className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {themes.map((theme) => (
          <DropdownMenuItem
            key={theme.id}
            onClick={() => setTheme(theme.id)}
            className="flex items-center gap-3 cursor-pointer py-3"
          >
            {/* Color preview dots */}
            <div className="flex gap-1 shrink-0">
              {Object.values(theme.preview).map((color, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full border border-foreground/20"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{theme.name}</div>
              <div className="text-xs text-muted-foreground truncate">{theme.description}</div>
            </div>
            {currentTheme === theme.id && (
              <Check className="h-4 w-4 text-primary shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
