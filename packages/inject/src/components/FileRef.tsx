import { type Component, createResource } from 'solid-js';
import type { Attachment } from '@pitstop/shared';
import { fetchConfig } from '../state/client';

const SCHEMES: Record<string, string> = {
  cursor: 'cursor://file/',
  vscode: 'vscode://file/',
  jetbrains: 'jetbrains://web-storm/navigate/reference?path=', // Approximation; works for IDEA family
};

function buildEditorUrl(att: Extract<Attachment, { kind: 'file-ref' }>, editor: string): string | null {
  const scheme = SCHEMES[editor];
  if (!scheme) return null;
  const lineSuffix = att.line ? `:${att.line}` : '';
  return `${scheme}${att.path}${lineSuffix}`;
}

async function copyPathToClipboard(path: string, line?: number): Promise<void> {
  const text = line ? `${path}:${line}` : path;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

export const FileRef: Component<{ att: Extract<Attachment, { kind: 'file-ref' }> }> = (props) => {
  const [config] = createResource(fetchConfig);

  const onClick = async (e: MouseEvent) => {
    const cfg = config();
    if (!cfg) return;
    const url = buildEditorUrl(props.att, cfg.editor);
    if (url) return; // Native anchor will open the URI scheme
    e.preventDefault();
    await copyPathToClipboard(props.att.path, props.att.line);
  };

  const href = () => {
    const cfg = config();
    if (!cfg) return '#';
    return buildEditorUrl(props.att, cfg.editor) ?? '#';
  };

  const tooltip = () => {
    const cfg = config();
    if (!cfg || cfg.editor === 'none') return 'Click to copy path';
    return `Open in ${cfg.editor}`;
  };

  return (
    <div class="fileref">
      <a class="path" href={href()} onClick={onClick} title={tooltip()}>
        {props.att.path}{props.att.line ? `:${props.att.line}` : ''}
      </a>
      <span class="stats">
        {props.att.diffStats && (
          <>
            <span class="add">+{props.att.diffStats.add}</span>
            <span class="sep">/</span>
            <span class="rem">−{props.att.diffStats.rem}</span>
            <span class="sep">·</span>
            <span>{props.att.diffStats.hunks} hunk{props.att.diffStats.hunks === 1 ? '' : 's'}</span>
          </>
        )}
      </span>
    </div>
  );
};
