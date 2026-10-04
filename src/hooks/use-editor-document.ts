import { useCallback, useState } from "react";

export interface EditorDocument {
  fileName: string;
  filePath: string;
  value: string;
  savedValue: string;
  saving: boolean;
  error: string | null;
}

export interface EditorDocumentController {
  document: EditorDocument | null;
  open(fileName: string, filePath: string, value: string): void;
  change(value: string): void;
  startSaving(): void;
  markSaved(value: string): void;
  fail(error: string): void;
  close(): void;
}

export function useEditorDocument(): EditorDocumentController {
  const [document, setDocument] = useState<EditorDocument | null>(null);

  const open = useCallback((fileName: string, filePath: string, value: string) => {
    setDocument({
      fileName,
      filePath,
      value,
      savedValue: value,
      saving: false,
      error: null,
    });
  }, []);

  const change = useCallback((value: string) => {
    setDocument((current) => (current ? { ...current, value, error: null } : current));
  }, []);

  const startSaving = useCallback(() => {
    setDocument((current) => (current ? { ...current, saving: true, error: null } : current));
  }, []);

  const markSaved = useCallback((value: string) => {
    setDocument((current) =>
      current ? { ...current, value, savedValue: value, saving: false, error: null } : current,
    );
  }, []);

  const fail = useCallback((error: string) => {
    setDocument((current) => (current ? { ...current, saving: false, error } : current));
  }, []);

  const close = useCallback(() => {
    setDocument(null);
  }, []);

  return { document, open, change, startSaving, markSaved, fail, close };
}
