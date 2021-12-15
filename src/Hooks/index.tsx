import { useState, useEffect, useRef } from 'react';
import Hark from 'hark';
import { startRecording, stopRecording } from './recorderHelpers';

// https://cloud.google.com/speech-to-text/docs/reference/rest/v1/RecognitionConfig
import { GoogleCloudRecognitionConfig } from './GoogleCloudRecognitionConfig';

// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
export interface SpeechRecognitionProperties {
  // continuous: do not pass continuous here, instead pass it as a param to the hook
  grammars?: SpeechGrammarList;
  interimResults?: boolean;
  lang?: string;
  maxAlternatives?: number;
}

const isEdgeChromium = navigator.userAgent.indexOf('Edg/') !== -1;

interface BraveNavigator extends Navigator {
  brave: {
    isBrave: () => Promise<boolean>;
  };
}

const AudioContext = window.AudioContext || (window as any).webkitAudioContext;

const SpeechRecognition =
  window.SpeechRecognition || (window as any).webkitSpeechRecognition;

let recognition: SpeechRecognition | null;

// Set recognition back to null for brave browser due to promise resolving
// after the conditional on line 31
if ((navigator as BraveNavigator).brave) {
  (navigator as BraveNavigator).brave.isBrave().then((bool) => {
    if (bool) recognition = null;
  });
}

// Chromium browsers will have the SpeechRecognition method
// but do not implement the functionality due to google wanting 💰
// this covers new Edge and line 22 covers Brave, the two most popular non-chrome chromium browsers
if (!isEdgeChromium && SpeechRecognition) {
  recognition = new SpeechRecognition();
}

export interface UseSpeechToTextTypes {
  continuous?: boolean;
  crossBrowser?: boolean;
  googleApiKey?: string;
  googleCloudRecognitionConfig?: GoogleCloudRecognitionConfig;
  onStartSpeaking?: () => any;
  onStoppedSpeaking?: () => any;
  speechRecognitionProperties?: SpeechRecognitionProperties;
  timeout?: number;
  useOnlyGoogleCloud?: boolean;
}

export default function useSpeechToText({
  continuous,
  crossBrowser,
  googleApiKey,
  googleCloudRecognitionConfig,
  onStartSpeaking,
  onStoppedSpeaking,
  speechRecognitionProperties,
  timeout,
  useOnlyGoogleCloud = false
}: UseSpeechToTextTypes) {
  const [isRecording, setIsRecording] = useState(false);

  const audioContextRef = useRef<AudioContext>();

  const [results, setResults] = useState<string[]>([]);
  const [interimResult, setInterimResult] = useState<string | undefined>();
  const [error, setError] = useState('');

  const timeoutId = useRef<number>();
  const mediaStream = useRef<MediaStream>();

  useEffect(() => {
    if (!crossBrowser && !recognition) {
      setError('Speech Recognition API is only available on Chrome');
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      setError('getUserMedia is not supported on this device/browser :(');
    }

    if ((crossBrowser || useOnlyGoogleCloud) && !googleApiKey) {
      console.error(
        'No google cloud API key was passed, google API will not be able to process speech'
      );
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
  }, []);

  // Chrome Speech Recognition API:
  // Only supported on Chrome browsers
  const chromeSpeechRecognition = () => {
    if (recognition) {
      // Continuous recording after stopped speaking event
      if (continuous) recognition.continuous = true;

      const { grammars, interimResults, lang, maxAlternatives } =
        speechRecognitionProperties || {};

      if (grammars) recognition.grammars = grammars;
      if (lang) recognition.lang = lang;
	  
	  console.log('ChromeSpeechRecognition')

      recognition.interimResults = interimResults || false;
      recognition.maxAlternatives = maxAlternatives || 1;

      // start recognition
      recognition.start();

      // speech successfully translated into text
      recognition.onresult = (e) => {
        const result = e.results[e.results.length - 1];
        const { transcript } = result[0];
		
		console.log('interimSetting', interimResults)
        // Allows for realtime speech result UI feedback
        if (interimResults) {
          if (result.isFinal) {
            setInterimResult(undefined);
            setResults((prevResults) => [...prevResults, transcript]);
          } else {
            let concatTranscripts = '';

            // If continuous: e.results will include previous speech results: need to start loop at the current event resultIndex for proper concatenation
            for (let i = e.resultIndex; i < e.results.length; i++) {
              concatTranscripts += e.results[i][0].transcript;
            }

            setInterimResult(concatTranscripts);
			console.log('interimResult', concatTranscripts);
          }
        } else {
          setResults((prevResults) => [...prevResults, transcript]);
        }
      };

      recognition.onaudiostart = () => setIsRecording(true);

      // Audio stopped recording or timed out.
      // Chrome speech auto times-out if no speech after a while
      recognition.onend = () => {
        setIsRecording(false);
      };
    }
  };

  const startSpeechToText = async () => {
    if (!useOnlyGoogleCloud && recognition) {
      chromeSpeechRecognition();
      return;
    }

    if (!crossBrowser && !useOnlyGoogleCloud) {
      return;
    }

    // Resume audio context due to google auto play policy
    // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current?.resume();
    }

    const stream = await startRecording({
      errHandler: () => setError('Microphone permission was denied'),
      audioContext: audioContextRef.current as AudioContext
    });

    // Stop recording if timeout
    if (timeout) {
      handleRecordingTimeout();
    }

    // stop previous mediaStream track if exists
    if (mediaStream.current) {
      mediaStream.current.getAudioTracks()[0].stop();
    }

    // Clones stream to fix hark bug on Safari
    mediaStream.current = stream.clone();

    const speechEvents = Hark(mediaStream.current, {
      audioContext: audioContextRef.current as AudioContext
    });

    speechEvents.on('speaking', () => {
      if (onStartSpeaking) onStartSpeaking();

      // Clear previous recording timeout on every speech event
      clearTimeout(timeoutId.current);
    });

    speechEvents.on('stopped_speaking', () => {
      if (onStoppedSpeaking) onStoppedSpeaking();

      setIsRecording(false);
      mediaStream.current?.getAudioTracks()[0].stop();

      // Stops current recording and sends audio string to google cloud.
      // recording will start again after google cloud api
      // call if `continuous` prop is true. Until the api result
      // returns, technically the microphone is not being captured again
      stopRecording({
        exportWAV: true,
        wavCallback: (blob) =>
          handleBlobToBase64({ blob, continuous: continuous || false })
      });
    });

    setIsRecording(true);
  };

  const stopSpeechToText = () => {
    if (recognition && !useOnlyGoogleCloud) {
      recognition.stop();
    } else {
      setIsRecording(false);
      mediaStream.current?.getAudioTracks()[0].stop();
      stopRecording({
        exportWAV: true,
        wavCallback: (blob) => handleBlobToBase64({ blob, continuous: false })
      });
    }
  };

  const handleRecordingTimeout = () => {
    timeoutId.current = window.setTimeout(() => {
      setIsRecording(false);
      mediaStream.current?.getAudioTracks()[0].stop();
      stopRecording({ exportWAV: false });
    }, timeout);
  };

  const handleBlobToBase64 = ({
    blob,
    continuous
  }: {
    blob: Blob;
    continuous: boolean;
  }) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);

    reader.onloadend = async () => {
      const base64data = reader.result as string;

      let sampleRate = audioContextRef.current?.sampleRate

      // Google only accepts max 48000 sample rate: if
      // greater recorder js will down-sample to 48000
      if (sampleRate && sampleRate > 44100) {
        sampleRate = 44100;
      }

      const audio = { content: '' };

      const negotiationPhrases = [
		'want',
		'except the',
		'all the remaining',
		'except',
		"that's it",
		'and',
		'take',
		'all of them',
		'want',
		'would like to',
		'would like',
		'want to',
		'need to',
		'like to',
		'rest is yours',
		'you can have the rest',
		'rest',
		'offer',
		'accept',
		'give me',
		'all remainings',
		'all remaining',
		'deal',
		'yes',
		'agree',
		'everything',
		'you can',
		'I can give'
      ];

      const domainKeywords = [	
		'zero',
		'one',
		'two',
		'three',
		'four',
        'one apple',
        'two apple',
        'two apples',
        'three apple',
        'three apples',
        'four apple',
        'four apples',
        'one banana',
        'two banana',
        'two bananas',
        'three banana',
        'three bananas',
        'four banana',
        'four bananas',
        'one orange',
        'two orange',
        'two oranges',
        'three orange',
        'three oranges',
        'four orange',
        'four oranges',
        'one watermelon',
        'two watermelon',
        'two watermelons',
        'three watermelon',
        'three watermelons',
        'four watermelon',
        'four watermelons',
        'all apples',
        'all oranges',
        'all bananas',
        'all watermelons',
        'all of apples',
        'all of oranges',
        'all of bananas',
        'all of watermelons',
        'all of the apples',
        'all of the oranges',
        'all of the bananas',
        'all of the watermelons',
        'zero apple',
        'zero orange',
        'zero banana',
        'zero watermelon',
        'all of them'
      ];	  

      const negoSpeechContextsElement = {
        phrases: negotiationPhrases,
        boost: 35.0
      };

      const domainSpeechContextsElement = {
        phrases: domainKeywords,
        boost: 45.0
      };

      const speechContexts = [
        negoSpeechContextsElement,
        domainSpeechContextsElement
      ];

      const config: GoogleCloudRecognitionConfig = {
        encoding: 'LINEAR16',
        languageCode: 'en-US',
		maxAlternatives: 10,
		useEnhanced: true,
        sampleRateHertz: sampleRate,
        speechContexts: speechContexts,
        ...googleCloudRecognitionConfig
      };

      const data = {
        config,
        audio
      };

      // Gets raw base 64 string data
      audio.content = base64data.substr(base64data.indexOf(',') + 1);

      const googleCloudRes = await fetch(
        `https://speech.googleapis.com/v1p1beta1/speech:recognize?key=${googleApiKey}`,
        {
          method: 'POST',
          body: JSON.stringify(data)
        }
      );

      const googleCloudJson = await googleCloudRes.json();

      // Update results state with transcribed text
      if (googleCloudJson.results?.length > 0) {
        setResults((prevResults) => [
          ...prevResults,
		  googleCloudJson.results[0].alternatives.reduce(function(prev:any, current:any) {
				return (prev.confidence > current.confidence) ? prev : current
		  }).transcript
          // googleCloudJson.results[0].alternatives[0].transcript
        ]);
      }

      if (continuous) {
        startSpeechToText();
      }
    };
  };

  return {
    error,
    interimResult,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText
  };
}
