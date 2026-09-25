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
/**
 * Shared primitives for every mobile screen.
 */

import type { ReactElement } from 'react';
import { Pressable, SafeAreaView, Text } from 'react-native';

import { styles } from './theme';

export function Button({
  label,
  onPress,
  secondary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondaryButton,
        danger && styles.dangerButton,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText, danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Centered({ children }: { children: ReactElement }) {
  return <SafeAreaView style={[styles.safe, styles.center]}>{children}</SafeAreaView>;
}

/** "0x1234…abcd" for long addresses / payloads */
export function shorten(value: string, head = 10, tail = 6): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}
