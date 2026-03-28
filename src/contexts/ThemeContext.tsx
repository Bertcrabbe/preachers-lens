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
    id: "forest-cathedral",
    name: "Forest Cathedral",
    description: "Deep evergreen with mossy gold & sage",
    preview: { bg: "#141e1a", card: "#2a3e32", primary: "#b8a848", accent: "#5a9a6a" },
  },
  {
    id: "arctic-steel",
    name: "Arctic Steel",
    description: "Cool grey-blue with icy cyan & silver",
    preview: { bg: "#f0f3f8", card: "#ffffff", primary: "#2880b8", accent: "#48a8c8" },
  },
  {
    id: "ny-knicks",
    name: "NY Knicks",
    description: "Madison Square Garden blue & orange",
    preview: { bg: "#0a1628", card: "#1a3050", primary: "#F58426", accent: "#006BB6" },
  },
];

interface ThemeContextType {
  currentTheme: string;
  setTheme: (themeId: string) => void;
  themes: ThemeDefinition[];
}

const ThemeContext = createContext<ThemeContextType>({
  currentTheme: "berts-badness",
  setTheme: () => {},
  themes: THEMES,
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState(() => {
    return localStorage.getItem("app-theme") || "berts-badness";
  });

  const applyTheme = useCallback((themeId: string) => {
    document.documentElement.setAttribute("data-theme", themeId);
  }, []);

  // Apply theme on mount and change
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme, applyTheme]);

  // Load from DB on auth
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

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}
