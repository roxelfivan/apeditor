import { useMemo, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import {
  labelsForHeadings,
  type OutlineScheme,
} from '@/utils/outlineNumbering';

interface Props {
  source: string;
  lineNumbers?: boolean;
  outlineScheme?: OutlineScheme;
  className?: string;
  style?: CSSProperties;
}

/**
 * Shared Preview renderer: GFM markdown plus optional source-line
 * gutters and heading outline labels. Does not mutate stored content.
 */
export function PreviewMarkdown({
  source,
  lineNumbers = false,
  outlineScheme = 'off',
  className = '',
  style,
}: Props) {
  const labels = useMemo(
    () => labelsForHeadings(source, outlineScheme),
    [source, outlineScheme]
  );
  const headingIndex = useRef(0);
  headingIndex.current = 0;

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

  return (
    <div
      data-print-root
      className={`prose-md ${lineNumbers ? 'preview-linenumbers' : ''} ${className}`.trim()}
      style={style}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          h1: heading('h1'),
          h2: heading('h2'),
          h3: heading('h3'),
          h4: heading('h4'),
          h5: heading('h5'),
          h6: heading('h6'),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
