
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessage, Intent, IntentClassification, KBSearchResult, EscalationDecision } from './types.js';
import { classifyIntent, searchKnowledgeBase, determineEscalation } from './services/geminiService.js';
import ChatInterface from './components/ChatInterface.js';
import { v4 as uuidv4 } from 'uuid';

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isConversationActive, setIsConversationActive] = useState<boolean>(false);
  const [awaitingResolutionConfirmation, setAwaitingResolutionConfirmation] = useState<boolean>(false);
  const [lastAgentIntent, setLastAgentIntent] = useState<Intent | null>(null);

  useEffect(() => {
    if (!process.env.API_KEY || process.env.API_KEY === "YOUR_ACTUAL_API_KEY") {
      const errorMsg = "API Key is not configured or is using a placeholder. Please set a valid API_KEY environment variable.";
      console.error(errorMsg);
      setApiKeyError(errorMsg);
      setIsConversationActive(false);
      setMessages(prev => [...prev, {
        id: uuidv4(),
        text: errorMsg,
        sender: 'system',
        timestamp: new Date(),
        intent: Intent.UNKNOWN,
      }]);
    } else {
      setMessages([
        {
          id: uuidv4(),
          text: "Hello! I'm your AI Customer Service Agent. How can I help you today?",
          sender: 'agent',
          timestamp: new Date(),
          intent: Intent.UNKNOWN,
        }
      ]);
      setIsConversationActive(true);
    }
  }, []);

  const addMessage = useCallback((text: string, sender: 'user' | 'agent' | 'system', intent?: Intent, topic?: string) => {
    setMessages(prev => [...prev, { id: uuidv4(), text, sender, timestamp: new Date(), intent, topic }]);
  }, []);

  const handleStartNewQuery = useCallback(() => {
    setIsConversationActive(true);
    setAwaitingResolutionConfirmation(false);
    setLastAgentIntent(null);
    addMessage("Please ask your next question.", 'system', Intent.UNKNOWN);
    setIsLoading(false);
  }, [addMessage]);

  const handlePositiveResolution = useCallback(() => {
    addMessage("Great! I'm glad I could help.", 'agent', lastAgentIntent || Intent.UNKNOWN);
    setAwaitingResolutionConfirmation(false);
    setLastAgentIntent(null);
    setIsLoading(false);
    handleStartNewQuery();
  }, [lastAgentIntent, addMessage, handleStartNewQuery]);

  const handleNegativeResolution = useCallback(() => {
    addMessage("I understand. Could you please rephrase your question or provide more details about the issue?", 'agent', lastAgentIntent || Intent.UNKNOWN);
    setAwaitingResolutionConfirmation(false);
    setLastAgentIntent(null);
    setIsConversationActive(true);
    setIsLoading(false);
  }, [lastAgentIntent, addMessage]);


  const handleSendMessage = useCallback(async (userInput: string) => {
    if (!userInput.trim() || apiKeyError) return;

    setIsLoading(true);
    addMessage(userInput, 'user');

    // Textual "yes/no" confirmation block has been REMOVED.
    // Button clicks will now call handlePositiveResolution or handleNegativeResolution.

    // If we were awaiting resolution for UNKNOWN intent, user would click a button.
    // If awaitingResolutionConfirmation is true but lastAgentIntent is UNKNOWN,
    // it means the UNKNOWN buttons should be shown. The ChatInterface handles this.
    // If it's true and lastAgentIntent is NOT UNKNOWN, general confirmation buttons are shown.
    // We only proceed with full query processing if not currently awaiting confirmation via buttons.
    if (awaitingResolutionConfirmation) {
        // This case should ideally not be hit if buttons are managing flow,
        // but as a safeguard, if a text message comes through while confirmation is pending,
        // we might need to reset or log. For now, we assume button clicks handle this.
        // The main processing below assumes this is a new query or a rephrased one after negative resolution.
        // The `handleNegativeResolution` already resets awaitingResolutionConfirmation.
    }


    let agentResponseText = "";
    let currentIntent: Intent = Intent.UNKNOWN;
    let topic: string | null = null;
    let kbSnippet: string | null = null;

    try {
      const kbResult: KBSearchResult | null = await searchKnowledgeBase(userInput);
      kbSnippet = kbResult?.snippet || null;

      if (kbSnippet) {
        currentIntent = Intent.TECHNICAL_SUPPORT;
        topic = kbResult?.relevantTopic || userInput.substring(0, 50).trim() + "...";
        agentResponseText = `Regarding "${topic}", here's some information from our knowledge base: "${kbSnippet}".`;
        addMessage(`Query content matched knowledge base. Classified as: ${currentIntent} (Source: KB).`, 'system', currentIntent, topic);
      } else {
        addMessage(`No direct answer in Knowledge Base. Proceeding with AI classification...`, 'system', Intent.UNKNOWN);
        const classification: IntentClassification | null = await classifyIntent(userInput);

        if (!classification) {
          agentResponseText = "I'm having trouble understanding your request. Could you please try rephrasing it?";
          currentIntent = Intent.UNKNOWN;
          addMessage("Error: Could not classify your query after KB search. Please try rephrasing.", 'system', Intent.UNKNOWN);
        } else {
          currentIntent = classification.intent;
          topic = classification.topic || userInput.substring(0, 50).trim() + "...";
          addMessage(`Query classified by AI as: ${currentIntent} (Topic: ${topic || 'N/A'})`, 'system', currentIntent, topic);

          switch (currentIntent) {
            case Intent.TECHNICAL_SUPPORT:
              agentResponseText = `Thanks for your query about "${topic}". I couldn't find an immediate answer in our knowledge base for this technical issue. Our team will look into this.`;
              break;
            case Intent.PRODUCT_FEATURE_REQUEST:
              agentResponseText = `Thank you for your suggestion! We've logged your feature request for "${topic}" for our product team to review.`;
              break;
            case Intent.SALES_LEAD:
              agentResponseText = `Thanks for your interest in our products/services regarding "${topic}"! Our sales team will be in touch soon. In the meantime, could you tell us more about your needs or your company?`;
              break;
            case Intent.UNKNOWN:
            default:
              agentResponseText = "I'm not sure how to help with that. What would you like to do?";
              break;
          }
        }
      }
      
      if (currentIntent !== Intent.UNKNOWN) {
        agentResponseText += " Does this resolve your issue?";
      }
      
      addMessage(agentResponseText, 'agent', currentIntent, topic);
      setLastAgentIntent(currentIntent);
      // This will trigger buttons for UNKNOWN, or general confirmation buttons for others.
      setAwaitingResolutionConfirmation(true); 
      setIsConversationActive(true); // Keep active, ChatInterface will hide input if buttons shown

      const escalationDecision: EscalationDecision | null = await determineEscalation(userInput, currentIntent, kbSnippet, agentResponseText);
      
      if (escalationDecision?.escalate) {
        const escalationDepartment = currentIntent === Intent.TECHNICAL_SUPPORT ? "Technical Support" : currentIntent === Intent.SALES_LEAD ? "Sales" : "the relevant";
        let escalationMessageText = `This issue has been flagged for escalation to our human ${escalationDepartment} team.`;
        if (escalationDecision.reason) {
           escalationMessageText += ` Reason: ${escalationDecision.reason}`;
        }
        addMessage(escalationMessageText, 'system', currentIntent, topic);
      }

    } catch (error) {
      console.error("Error processing message:", error);
      let errorMessage = "An error occurred while processing your request.";
      if (error instanceof Error) {
        errorMessage += ` Details: ${error.message}`;
      }
      addMessage(errorMessage, 'system');
      setAwaitingResolutionConfirmation(false); // Reset on error
      setLastAgentIntent(null);
      setIsConversationActive(false); // Stop conversation on error
      if (!apiKeyError) {
         addMessage("The agent has finished processing your query due to an error. Click 'Ask Another Question' below to continue.", 'system');
      }
    } finally {
      setIsLoading(false);
    }
  }, [apiKeyError, addMessage, awaitingResolutionConfirmation]); // Removed lastAgentIntent from deps as direct text handling is gone

  const handleRephraseUnknownQuery = useCallback(() => {
    addMessage("Okay, please rephrase your previous question or provide more details.", 'agent', Intent.UNKNOWN);
    setAwaitingResolutionConfirmation(false);
    setLastAgentIntent(null);
    setIsConversationActive(true); 
    setIsLoading(false);
  }, [addMessage]);

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto p-4">
      <header className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          Nullaxis.AI Customer Service Agent
        </h1>
      </header>
      {apiKeyError && (
         <div className="bg-red-700 text-white p-3 rounded-md mb-4 text-center">
          <strong>Configuration Error:</strong> {apiKeyError}
        </div>
      )}
      <ChatInterface
        messages={messages}
        onSendMessage={handleSendMessage}
        isLoading={isLoading || !!apiKeyError} // Consider apiKeyError as a loading/non-interactive state for input
        isConversationActive={isConversationActive && !isLoading && !awaitingResolutionConfirmation} // Input active if no buttons shown
        onStartNewQuery={handleStartNewQuery}
        showUnknownIntentOptions={awaitingResolutionConfirmation && lastAgentIntent === Intent.UNKNOWN && !isLoading}
        onRephraseUnknownIntentQuery={handleRephraseUnknownQuery}
        showGeneralConfirmationOptions={awaitingResolutionConfirmation && lastAgentIntent !== null && lastAgentIntent !== Intent.UNKNOWN && !isLoading}
        onPositiveResolution={handlePositiveResolution}
        onNegativeResolution={handleNegativeResolution}
      />
    </div>
  );
};

export default App;
