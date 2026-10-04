import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemedStyles, type AppTheme } from '../theme';

export function Screen({ children, style, edges=['top','right','bottom','left'] }: { children: React.ReactNode; style?: ViewStyle; edges?: Array<'top'|'right'|'bottom'|'left'> }) {const {styles}=useThemedStyles(createStyles);
  return <SafeAreaView edges={edges} style={styles.safe}><View style={[styles.body, style]}>{children}</View></SafeAreaView>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({ safe:{flex:1,backgroundColor:theme.colors.background}, body:{flex:1,width:'100%',maxWidth:760,alignSelf:'center'} });
