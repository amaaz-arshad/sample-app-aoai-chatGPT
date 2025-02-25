import React, { useEffect, useState } from 'react';
import Navbar from '../../components/Navbar/Navbar';

interface ChatRow {
  timestamp: string;
  system_message: string;
  user_prompt: string;
  assistant_answer: string;
}

const History: React.FC = () => {
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/table_data');
        if (!response.ok) {
          throw new Error('Failed to fetch table data');
        }
        const data: ChatRow[] = await response.json();
        setRows(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  
  if (error) return <div>Error: {error}</div>;

  return (
    <>
    <Navbar />
    
    <div style={{ padding: '1rem' }}>
      <h2>Chat Conversations</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>Timestamp</th>
            <th style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>System Message</th>
            <th style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>User Prompt</th>
            <th style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>Assistant Answer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{row.timestamp}</td>
              <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{row.system_message}</td>
              <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{row.user_prompt}</td>
              <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{row.assistant_answer}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
};

export default History;
