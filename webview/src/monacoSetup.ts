import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";

type MonacoWorkerLabel =
  | "json"
  | "css"
  | "scss"
  | "less"
  | "html"
  | "handlebars"
  | "razor"
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | string;

declare const self: typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: MonacoWorkerLabel) => Worker;
  };
};

const workers: Record<string, () => Worker> = {
  json: () => new JsonWorker(),
  css: () => new CssWorker(),
  scss: () => new CssWorker(),
  less: () => new CssWorker(),
  html: () => new HtmlWorker(),
  handlebars: () => new HtmlWorker(),
  razor: () => new HtmlWorker(),
  typescript: () => new TsWorker(),
  javascript: () => new TsWorker(),
  tsx: () => new TsWorker(),
  jsx: () => new TsWorker(),
};

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: MonacoWorkerLabel): Worker {
    const factory = workers[label];
    if (factory) {
      return factory();
    }

    return new EditorWorker();
  },
};

loader.config({ monaco });
