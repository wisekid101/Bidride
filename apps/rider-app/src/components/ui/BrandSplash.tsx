import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { Brand, Colors, Fonts, Motion, Spacing, Typography } from '../../constants/theme';
import { BrandMark } from './BrandMark';

// Branded animated splash shown on cold start, layered above the app while it
// hydrates. The native splash (solid navy) hands off seamlessly to this, so the
// first thing the user sees is a designed, animated identity — not a blank flash.
// Calls onFinish once the intro + optional `ready` gate have both resolved.
interface BrandSplashProps {
  onFinish: () => void;
  // When false, the splash holds (keeps animating its glow) until it flips true
  // — lets the caller gate reveal on token/session hydration.
  ready?: boolean;
}

export function BrandSplash({ onFinish, ready = true }: BrandSplashProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const markScale = useRef(new Animated.Value(0.82)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0.4)).current;
  const introDone = useRef(false);
  const finished = useRef(false);

  // Intro: mark scales/fades in, tagline follows, then a gentle looping glow.
  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(markScale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(markOpacity, { toValue: 1, duration: Motion.slow, useNativeDriver: true }),
      ]),
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: Motion.base,
        delay: 40,
        useNativeDriver: true,
      }),
    ]).start(() => {
      introDone.current = true;
      maybeFinish();
    });

    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.4, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    // Safety net: reveal the app no matter what after a hard cap, so a slow
    // `ready` (e.g. offline font load) can NEVER leave the splash stuck.
    const safety = setTimeout(finish, 4500);
    return () => clearTimeout(safety);
    // Intro animation runs once on mount; refs are stable.
  }, []);

  useEffect(() => {
    if (ready) maybeFinish();
  }, [ready]);

  // Fade out and hand control to the app. Unconditional — callers gate via maybeFinish.
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: Motion.base,
      delay: 120,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => onFinish());
  };

  const maybeFinish = () => {
    if (!introDone.current || !ready) return;
    finish();
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.container, { opacity }]} pointerEvents="none">
      <Animated.View style={[styles.glowRing, { opacity: glow, transform: [{ scale: markScale }] }]} />
      <Animated.View style={{ opacity: markOpacity, transform: [{ scale: markScale }] }}>
        <BrandMark layout="stacked" size="hero" />
      </Animated.View>
      <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]} allowFontScaling={false}>
        {Brand.tagline}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Colors.primarySoft,
  },
  tagline: {
    marginTop: Spacing.xl,
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 0.2,
  },
});
