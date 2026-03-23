import React, { useEffect } from "react";
import { useEditorStore } from "./store/blueprint-store";
import { TopBar } from "./components/TopBar";
import { SceneTree } from "./components/SceneTree";
import { PreviewPane } from "./components/PreviewPane";
import { PropertyPanel } from "./components/PropertyPanel";
import { Timeline } from "./components/Timeline";

export const App: React.FC = () => {
  const loadBlueprint = useEditorStore((s) => s.loadBlueprint);
  const saveBlueprint = useEditorStore((s) => s.saveBlueprint);

  useEffect(() => {
    loadBlueprint();
  }, [loadBlueprint]);

  // Ctrl+S 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveBlueprint();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveBlueprint]);

  return (
    <div className="editor-root">
      <TopBar />
      <div className="editor-main">
        <SceneTree />
        <PreviewPane />
        <PropertyPanel />
      </div>
      <Timeline />
    </div>
  );
};
