'use client';
import { Component, type ReactNode } from 'react';

/** If the 3D campus throws, show the flat/CSS fallback instead (campus3d.md §6). */
export class Campus3DBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('Campus3D failed, using fallback', e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
