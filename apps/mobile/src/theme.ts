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
 * Shared visual language for the mobile app.
 *
 * Dark-first palette in the spirit of MetaMask Mobile / TokenPocket /
 * OneKey: near-black canvas, raised cards, one accent. Every screen
 * imports from here so a future light theme is a single-file change.
 */

import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#101114',
  card: '#1a1d23',
  inset: '#252a33',
  border: '#303641',
  borderStrong: '#424b59',
  text: '#f5f7fa',
  textSecondary: '#b4bfcd',
  textTertiary: '#78818f',
  accent: '#78a9ff',
  accentInk: '#101114',
  danger: '#ff8f8f',
  warning: '#f2b97f',
  success: '#7ddf9e',
};

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  screen: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 14 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 20, gap: 14 },
  heading: { color: colors.text, fontSize: 22, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  warning: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  mnemonic: { color: colors.text, backgroundColor: colors.inset, borderRadius: 10, padding: 16, lineHeight: 26, fontSize: 16 },
  input: { color: colors.text, backgroundColor: colors.inset, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 16 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 2 },
  secondaryButton: { backgroundColor: 'transparent', borderColor: colors.borderStrong, borderWidth: 1 },
  dangerButton: { backgroundColor: 'transparent', borderColor: colors.danger, borderWidth: 1 },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
  secondaryText: { color: '#d8e0eb' },
  dangerText: { color: colors.danger },
  error: { color: colors.danger, textAlign: 'center', marginTop: 16 },
  account: { backgroundColor: colors.inset, borderRadius: 10, padding: 14, gap: 6 },
  accountName: { color: colors.text, fontWeight: '700' },
  address: { color: '#aeb9c8', fontSize: 12 },
  balance: { color: colors.accent, fontSize: 24, fontWeight: '700' },
  section: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 8 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: colors.inset, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: '#d8e0eb', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.accentInk },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  assetSymbol: { color: colors.text, fontWeight: '700' },
  assetBalance: { color: colors.accent, fontWeight: '600' },
  assetZero: { opacity: 0.4 },

  // ── bottom tab bar (MetaMask / TP style) ──
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 6,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 9, gap: 3 },
  tabLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: colors.accent },
  tabIcon: { fontSize: 17 },

  // ── dApps / sessions ──
  sessionCard: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  dappName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  monoSmall: { color: colors.textTertiary, fontSize: 11 },
  requestBox: { backgroundColor: colors.inset, borderRadius: 10, padding: 12, gap: 6 },
  requestText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  badge: { backgroundColor: colors.inset, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
});
