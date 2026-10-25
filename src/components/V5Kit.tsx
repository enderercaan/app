import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useThemedStyles, type AppTheme } from '../theme';

// Small shared building blocks for the spec v5.0 screens (privacy, care, support, communities).
export function V5Section({title,help,children}:{title:string;help?:string;children:ReactNode}){
  const {styles}=useThemedStyles(createStyles);
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{help?<Text style={styles.help}>{help}</Text>:null}{children}</View>;
}

export function V5Field({label,...props}:TextInputProps&{label:string}){
  const {styles,theme}=useThemedStyles(createStyles);
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={theme.colors.muted} {...props} style={[styles.input,props.multiline?styles.multiline:null]}/></View>;
}

export function V5Chips<T extends string>({options,value,onChange,labelFor}:{options:readonly T[];value:T|T[]|null;onChange:(next:T)=>void;labelFor:(option:T)=>string}){
  const {styles}=useThemedStyles(createStyles);
  const selected=(option:T)=>Array.isArray(value)?value.includes(option):value===option;
  return <View style={styles.chips}>{options.map(option=><Pressable key={option} accessibilityRole="button" accessibilityState={{selected:selected(option)}} onPress={()=>onChange(option)} style={[styles.chip,selected(option)?styles.chipOn:null]}><Text style={[styles.chipText,selected(option)?styles.chipTextOn:null]}>{labelFor(option)}</Text></Pressable>)}</View>;
}

export function V5Row({title,meta,children}:{title:string;meta?:string;children?:ReactNode}){
  const {styles}=useThemedStyles(createStyles);
  return <View style={styles.row}><View style={{flex:1}}><Text style={styles.rowTitle}>{title}</Text>{meta?<Text style={styles.rowMeta}>{meta}</Text>:null}</View>{children?<View style={styles.rowActions}>{children}</View>:null}</View>;
}

export function V5Link({label,onPress,danger}:{label:string;onPress:()=>void;danger?:boolean}){
  const {styles}=useThemedStyles(createStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}><Text style={[styles.link,danger?styles.linkDanger:null]}>{label}</Text></Pressable>;
}

export function V5Notice({text,tone='info'}:{text:string;tone?:'info'|'warning'}){
  const {styles}=useThemedStyles(createStyles);
  return <View style={[styles.notice,tone==='warning'?styles.noticeWarning:null]}><Text style={styles.noticeText}>{text}</Text></View>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  section:{padding:14,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface,marginBottom:12,gap:8},
  sectionTitle:{fontSize:16,fontWeight:'900',color:theme.colors.text},
  help:{fontSize:12,fontWeight:'600',color:theme.colors.muted,lineHeight:17},
  field:{gap:4},
  label:{fontSize:12,fontWeight:'800',color:theme.colors.muted},
  input:{minHeight:44,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surfaceAlt,paddingHorizontal:12,paddingVertical:10,color:theme.colors.text,fontSize:15},
  multiline:{minHeight:96,textAlignVertical:'top'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6},
  chip:{paddingHorizontal:11,paddingVertical:7,borderRadius:999,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surfaceAlt},
  chipOn:{backgroundColor:theme.colors.primary,borderColor:theme.colors.primary},
  chipText:{fontSize:12,fontWeight:'800',color:theme.colors.text},
  chipTextOn:{color:theme.colors.onPrimary},
  row:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.colors.border},
  rowTitle:{fontSize:14,fontWeight:'800',color:theme.colors.text},
  rowMeta:{marginTop:2,fontSize:12,fontWeight:'600',color:theme.colors.muted},
  rowActions:{flexDirection:'row',alignItems:'center',gap:12},
  link:{fontSize:13,fontWeight:'900',color:theme.colors.primary},
  linkDanger:{color:theme.colors.danger},
  notice:{padding:10,borderRadius:12,backgroundColor:theme.colors.surfaceAlt},
  noticeWarning:{borderWidth:1,borderColor:theme.colors.danger},
  noticeText:{fontSize:12,fontWeight:'700',color:theme.colors.text,lineHeight:17}
});
