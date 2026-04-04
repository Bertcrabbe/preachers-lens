import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  preview: { bg: string; card: string; primary: string; accent: string };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "berts-badness",
    name: "Bert's Badness",
    description: "Deep slate blue with warm gold & hot coral",
    preview: { bg: "#232b4a", card: "#4a5580", primary: "#e8a838", accent: "#e8553a" },
  },
  {
    id: "midnight-ember",
    name: "Midnight Ember",
    description: "Near-black with smoldering orange & crimson",
    preview: { bg: "#1a1418", card: "#3a2e34", primary: "#e87040", accent: "#c43030" },
  },
  {
    id: "arctic-steel",
    name: "Arctic Steel",
    description: "Cool grey-blue with icy cyan & silver",
    preview: { bg: "#f0f3f8", card: "#ffffff", primary: "#2880b8", accent: "#48a8c8" },
  },
  {
    id: "seahawks",
    name: "Seahawks",
    description: "College Navy with Action Green & Wolf Grey",
    preview: { bg: "#152044", card: "#2e3f6e", primary: "#69be28", accent: "#7c8a96" },
  },
  {
    id: "ny-giants",
    name: "NY Giants",
    description: "Royal blue with classic red & platinum white",
    preview: { bg: "#0b2265", card: "#1b3a8a", primary: "#a71930", accent: "#a5acaf" },
  },
  {
    id: "green-bay-packers",
    name: "Green Bay Packers",
    description: "Dark green with gold & white",
    preview: { bg: "#203731", card: "#2e4f45", primary: "#ffb612", accent: "#ffffff" },
  },
];

interface ThemeContextType {
  currentTheme: string;
  setTheme: (themeId: string) => void;
  themes: ThemeDefinition[];
  renameTheme: (themeId: string, newName: string) => void;
  customNames: Record<string, string>;
}

const ThemeContext = createContext<ThemeContextType>({
  currentTheme: "berts-badness",
  setTheme: () => {},
  themes: THEMES,
  renameTheme: () => {},
  customNames: {},
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState(() => {
    return localStorage.getItem("app-theme") || "berts-badness";
  });

  const [customNames, setCustomNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("theme-custom-names") || "{}");
    } catch {
      return {};
    }
  });

  const applyTheme = useCallback((themeId: string) => {
    document.documentElement.setAttribute("data-theme", themeId);
  }, []);

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme, applyTheme]);

  useEffect(() => {
    const loadTheme = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_preferences")
        .select("theme")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.theme) {
        setCurrentTheme(data.theme);
        localStorage.setItem("app-theme", data.theme);
      }
    };
    loadTheme();
  }, []);

  const setTheme = useCallback(async (themeId: string) => {
    setCurrentTheme(themeId);
    localStorage.setItem("app-theme", themeId);
    applyTheme(themeId);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("user_preferences").upsert(
      { user_id: user.id, theme: themeId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  }, [applyTheme]);

  const renameTheme = useCallback((themeId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCustomNames((prev) => {
      const updated = { ...prev, [themeId]: trimmed };
      localStorage.setItem("theme-custom-names", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const themedList = THEMES.map((t) => ({
    ...t,
    name: customNames[t.id] || t.name,
  }));

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, themes: themedList, renameTheme, customNames }}>
      {children}
    </ThemeContext.Provider>
  );
}
