import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import IssueAnalyzer from './IssueAnalyzer.jsx';

const PASSWORD = 'spaqhsqn';

function PasswordGate() {
  const [input, setInput] = useState('');
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState(false);

  if (authed) return <IssueAnalyzer />;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input === PASSWORD) {
      setAuthed(true);
    } else {
      setError(true);
      setInput('');
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#f5f5f5', fontFamily: 'sans-serif'
    }}>
      <div style={{
        background: '#fff', padding: '40px 48px', borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)', minWidth: '320px', textAlign: 'center'
      }}>
        <h2 style={{ marginBottom: '8px', color: '#1a1a2e' }}>Contract Intelligence</h2>
        <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>접속 비밀번호를 입력하세요</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(false); }}
            placeholder="비밀번호"
            autoFocus
            style={{
              width: '100%', padding: '10px 14px', fontSize: '16px',
              border: error ? '2px solid #e53e3e' : '2px solid #e2e8f0',
              borderRadius: '8px', outline: 'none', boxSizing: 'border-box', marginBottom: '8px'
            }}
          />
          {error && <p style={{ color: '#e53e3e', fontSize: '13px', marginBottom: '8px' }}>비밀번호가 올바르지 않습니다</p>}
          <button type="submit" style={{
            width: '100%', padding: '10px', background: '#2d3a8c', color: '#fff',
            border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'pointer', marginTop: '4px'
          }}>
            입장
          </button>
        </form>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate />
  </React.StrictMode>
);
