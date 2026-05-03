import { type Component } from 'solid-js';
import type { Attachment } from '@walkthrough/shared';

const editorScheme = 'cursor'; // overridden by config in Phase 6

function buildEditorUrl(att: Extract<Attachment, { kind: 'file-ref' }>): string {
  const lineSuffix = att.line ? `:${att.line}` : '';
  return `${editorScheme}://file/${att.path}${lineSuffix}`;
}

export const FileRef: Component<{ att: Extract<Attachment, { kind: 'file-ref' }> }> = (props) => (
  <div class="fileref">
    <a class="path" href={buildEditorUrl(props.att)}>{props.att.path}{props.att.line ? `:${props.att.line}` : ''}</a>
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
