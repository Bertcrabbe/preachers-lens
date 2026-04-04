import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { Palette, Check, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ThemeSwitcher() {
  const { currentTheme, setTheme, themes, renameTheme } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEditing = (e: React.MouseEvent, themeId: string, currentName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(themeId);
    setEditValue(currentName);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      renameTheme(editingId, editValue);
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setEditingId(null); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-foreground/70 hover:text-foreground">
          <Palette className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {themes.map((theme) => {
          const isEditing = editingId === theme.id;
          return (
            <div
              key={theme.id}
              role="menuitem"
              onClick={() => { if (!editingId) setTheme(theme.id); }}
              className="flex items-center gap-3 cursor-pointer py-3 px-2 rounded-sm hover:bg-accent/50 text-sm outline-none"
            >
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
                {isEditing ? (
                  <Input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={commitEdit}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 text-sm px-2 py-0"
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">{theme.name}</span>
                    <button
                      onClick={(e) => startEditing(e, theme.id, theme.name)}
                      className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-primary/10"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {!isEditing && (
                  <div className="text-xs text-muted-foreground truncate">{theme.description}</div>
                )}
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
