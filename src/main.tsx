import React from 'react';
import ReactDOM from 'react-dom/client';
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material';
import App from './App.tsx';
import './styles.css';
const theme = createTheme({
  palette: {
    primary: { main: '#245849', dark: '#173f35', light: '#e8f0ec' },
    secondary: { main: '#65796f' },
    background: { default: '#f5f6f3', paper: '#ffffff' },
    text: { primary: '#20352d', secondary: '#78827c' },
    divider: '#e8ebe6',
    error: { main: '#b64c43' },
    warning: { main: '#af7c24' },
    success: { main: '#3c8163' },
  },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: { fontWeight: 650, letterSpacing: '-1px' },
    h6: { fontWeight: 600, letterSpacing: '-.4px' },
    button: { textTransform: 'none', fontWeight: 600, fontSize: '13px' },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, minHeight: 38, paddingInline: 15 },
        outlined: { borderColor: '#dce2dc' },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { fontSize: 13, backgroundColor: '#fff' },
        notchedOutline: { borderColor: '#dfe5de' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#edf0eb' },
        head: {
          background: '#fafbf9',
          fontSize: 11,
          fontWeight: 600,
          color: '#7d877f',
          paddingBlock: 12,
          letterSpacing: '.3px',
        },
        body: { fontSize: 13, paddingBlock: 17 },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500, fontSize: 11, borderRadius: 6 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiCheckbox: { styleOverrides: { root: { color: '#c5cec5' } } },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
