import React from 'react';

import useSpeechToText from './Hooks';

import micIcon from './mic.svg';

import './App.css';

export default function App() {
  const {
    error,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText,
    interimResult
  } = useSpeechToText({
    continuous: true,
    timeout: 10000000,
    googleApiKey: process.env.REACT_APP_GCP_KEY,
    useOnlyGoogleCloud: true,
    speechRecognitionProperties: { interimResults: true }
  });

  if (error) {
    return (
      <div
        style={{
          maxWidth: '600px',
          margin: '100px auto',
          textAlign: 'center'
        }}
      >
        <p>
          {error}
          <span style={{ fontSize: '3rem' }}>🤷‍</span>
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '600px',
        margin: '100px auto',
        textAlign: 'center'
      }}
    >
      <h1>Recording: {isRecording.toString()}</h1>
      <button onClick={isRecording ? stopSpeechToText : startSpeechToText}>
        <span>{isRecording ? 'Stop Recording' : 'Start Recording'}</span>
        <img data-recording={isRecording} src={micIcon} alt="" />
      </button>
      <ul>
        {results.map((result, index) => (
          <li key={index}>{result}</li>
        ))}
        {interimResult && <li>{interimResult}</li>}
      </ul>
    </div>
  );
}
