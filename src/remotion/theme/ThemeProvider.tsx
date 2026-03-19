/**
 * 主题提供者 - 简化版
 */
import React, { createContext, useContext } from "react";

export interface OverlayTheme {
  primary: string;
  background: string;
}

const defaultTheme: OverlayTheme = {
  primary: "#2563EB",
  background: "#0F172A",
};

const ThemeContext = createContext<OverlayTheme>(defaultTheme);

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{
  theme?: Partial<OverlayTheme>;
  children: React.ReactNode;
}> = ({ theme, children }) => (
  <ThemeContext.Provider value={{ ...defaultTheme, ...theme }}>
    {children}
  </ThemeContext.Provider>
);
