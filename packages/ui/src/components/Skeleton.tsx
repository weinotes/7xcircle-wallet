/**
 * Copyright 2026 Davey Wong <wgwcko@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  /** Round fully — for avatar/icon placeholders */
  circle?: boolean;
}

/**
 * Shimmering placeholder for content that is still loading. Replaces the
 * "..." / blank-flash pattern: the layout stays stable, so nothing jumps
 * when real data lands. Hidden from assistive tech — it conveys nothing.
 */
export function Skeleton({ width = '100%', height = 16, circle, style, ...rest }: SkeletonProps) {
  return (
    <div
      className="ow-skeleton"
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: circle ? 'var(--ow-radius-full)' : 'var(--ow-radius-sm)',
        background:
          'linear-gradient(90deg, var(--ow-bg-tertiary) 25%, var(--ow-bg-hover) 50%, var(--ow-bg-tertiary) 75%)',
        backgroundSize: '200% 100%',
        animation: 'ow-shimmer 1.4s var(--ow-ease) infinite',
        ...style,
      }}
      {...rest}
    />
  );
}
