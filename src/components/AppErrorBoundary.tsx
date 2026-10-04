import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useThemedStyles, type AppTheme } from '../theme';
import { getRuntimeLocale, translate } from '../i18n';
import { reportReactBoundaryError } from '../services/errorTelemetry';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { theme, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.root} accessibilityRole="alert">
      <View style={styles.icon}>
        <AppIcon name="warning" size={30} color={theme.colors.danger} />
      </View>
      <Text style={styles.title}>{translate(getRuntimeLocale(),'errorBoundary.title')}</Text>
      <Text style={styles.body}>{translate(getRuntimeLocale(),'errorBoundary.body')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translate(getRuntimeLocale(),'errorBoundary.retry')}
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>{translate(getRuntimeLocale(),'common.retry')}</Text>
      </Pressable>
    </View>
  );
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Never serialize component props/state or transmit raw error messages/stacks.
    // Production reporting sends only a local fingerprint and bounded technical metadata.
    if (__DEV__) console.error('Tailmance UI boundary caught an error', error);
    void reportReactBoundaryError(error);
  }

  private retry = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback onRetry={this.retry} />;
  }
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.colors.background
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: theme.colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    marginTop: 18,
    ...theme.type.h1,
    color: theme.colors.text,
    textAlign: 'center'
  },
  body: {
    marginTop: 8,
    ...theme.type.body,
    color: theme.colors.muted,
    textAlign: 'center',
    maxWidth: 360
  },
  button: {
    marginTop: 20,
    minHeight: 50,
    minWidth: 144,
    paddingHorizontal: 20,
    borderRadius: 25,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressed: { opacity: 0.72 },
  buttonText: { color: theme.colors.onPrimary, fontWeight: '900' }
});
