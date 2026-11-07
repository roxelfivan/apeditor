import {
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import {
  labelsForHeadings,
  type OutlineScheme,
} from '@/utils/outlineNumbering';
import {
  ResizablePreviewTable,
  ResizablePreviewTh,
} from '@/components/ResizablePreviewTable';

interface Props {
  source: string;
  lineNumbers?: boolean;
  outlineScheme?: OutlineScheme;
  className?: string;
  style?: CSSProperties;
  /** When set, column widths persist per document in layout. */
  docId?: string | null;
}

/**
 * Shared Preview renderer: GFM markdown plus optional source-line
 * gutters and heading outline labels. Does not mutate stored content.
 * Tables support drag-to-resize columns with wrapping cell text.
 *
 * Important: the `components` map must be referentially stable across
 * re-renders. Recreating `table` / heading factories each render makes
 * react-markdown remount every table, which wipes resize state and
 * makes drag handles feel dead.
 */
export function PreviewMarkdown({
  source,
  lineNumbers = false,
  outlineScheme = 'off',
  className = '',
  style,
  docId = null,
}: Props) {
  const labels = useMemo(
    () => labelsForHeadings(source, outlineScheme),
    [source, outlineScheme]
  );
  const headingIndex = useRef(0);
  const tableIndex = useRef(0);
  // Reset counters once per source render pass (before ReactMarkdown walks).
  headingIndex.current = 0;
  tableIndex.current = 0;

  const docIdRef = useRef(docId);
  docIdRef.current = docId;

  const components = useMemo(() => {
    const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      function Heading({
        children,
        ...props
      }: HTMLAttributes<HTMLHeadingElement>) {
        const i = headingIndex.current;
        headingIndex.current += 1;
        const label = labels[i];
        return (
          <Tag {...props}>
            {label ? (
              <span className="outline-num" aria-hidden="true">
                {label}{' '}
              </span>
            ) : null}
            {children}
          </Tag>
        );
      };

    const table = function Table(
      props: ComponentPropsWithoutRef<'table'> & {
        node?: unknown;
        'data-line'?: string;
      }
    ) {
      const { node: _node, 'data-line': dataLine, ...rest } = props;
      const idx = tableIndex.current;
      tableIndex.current += 1;
      return (
        <ResizablePreviewTable
          {...rest}
          docId={docIdRef.current}
          tableIndex={idx}
          data-line={dataLine}
        />
      );
    };

    return {
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      h4: heading('h4'),
      h5: heading('h5'),
      h6: heading('h6'),
      table,
      th: ResizablePreviewTh,
    };
    // `labels` is the only value headings close over that changes with
    // content/outline. docId is read via ref so table identity stays put.
  }, [labels]);

  return (
    <div
      data-print-root
      className={`prose-md ${lineNumbers ? 'preview-linenumbers' : ''} ${className}`.trim()}
      style={style}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
