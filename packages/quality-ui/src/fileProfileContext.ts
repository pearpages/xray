import { createContext, useContext } from "react";

/** Opens the file profile; any file path in the report can be a way in. */
export const FileProfileContext = createContext<(file: string) => void>(() => {});

export const useOpenFile = () => useContext(FileProfileContext);
