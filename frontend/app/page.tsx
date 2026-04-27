'use client';

import { useState } from 'react';
import axios from 'axios';

interface AnalysisData {
  stock: string;
  decision: {
    finalDecision: string;
    finalConfidenceScore: number;
    reason: string;
  };
  risk: {
    riskLevel: string;
    riskScore: number;
    majorRisks: any;
  };
  learning: {
    learningBoost: number;
    learningInsight: string;
  };
  performance: {
    performanceScore: number;
    performanceInsight: string;
  };
  rebalancing: {
    rebalancingAdvice: string;
  };
  analysis: {
    stockFundamentals: string;
  };
  portfolio: {
    healthScore: number;
    dominantSector: string;
  }
}

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalysis = async () => {
    if (!inputValue.trim()) return;

    try {
      setLoading(true);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const res = await axios.post(`${apiUrl}/api/analyze`, {
        symbol: inputValue,
      });

      console.log("API RESPONSE:", res.data);
      // Backend returns { success: true, data: { ... } } or just { ... }
      const data = res.data.data || res.data;
      setAnalysis(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const agentCards = analysis
    ? [
        {
          title: 'Research Agent',
          content: analysis.analysis?.stockFundamentals || 'No research analysis available',
        },
        {
          title: 'Risk Agent',
          content: `Risk Level: ${analysis.risk?.riskLevel || 'N/A'}\nScore: ${analysis.risk?.riskScore || 0}/10\nDetails: ${typeof analysis.risk?.majorRisks === 'string' ? analysis.risk.majorRisks : JSON.stringify(analysis.risk?.majorRisks)}`,
        },
        {
          title: 'Learning Agent',
          content: `Boost: +${analysis.learning?.learningBoost || 0}\nInsight: ${analysis.learning?.learningInsight || 'N/A'}`,
        },
        {
          title: 'Performance Agent',
          content: `Validation Score: +${analysis.performance?.performanceScore || 0}\nInsight: ${analysis.performance?.performanceInsight || 'N/A'}`,
        },
        {
          title: 'Portfolio Agent',
          content: `Health: ${analysis.portfolio?.healthScore || 0}/10\nSector: ${analysis.portfolio?.dominantSector || 'N/A'}`,
        },
      ]
    : [];

  return (
    <main className="min-h-screen p-10">
      <h1 className="text-5xl font-bold mb-10">
        Fin<span className="gradient-text">Sight</span> Agent
      </h1>

      {/* Input Section */}
      <div className="card mb-10">
        <h2 className="text-2xl font-semibold mb-4">
          Analyze a Company
        </h2>

        <div className="flex flex-col md:flex-row gap-4">
          <input
            type="text"
            placeholder="Enter company name or symbol (e.g. AAPL, NVDA, TSLA)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 p-4 rounded-xl border border-gray-600 bg-transparent outline-none"
          />

          <button
            onClick={fetchAnalysis}
            className="px-8 py-4 rounded-xl font-semibold bg-white text-black transition-all hover:bg-gray-200"
          >
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>

      {/* Initial Empty State */}
      {!analysis && !loading && (
        <div className="card text-center py-20">
          <h2 className="text-2xl font-semibold mb-4">
            Waiting for Analysis
          </h2>
          <p className="opacity-80">
            Enter a company name above and generate your full multi-agent investment report.
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="card text-center py-20 animate-pulse">
          <h2 className="text-2xl font-semibold mb-4">
            Running Multi-Agent Analysis...
          </h2>
          <p className="opacity-80">
            Research, Risk, Learning, and Performance agents are coordinating your report...
          </p>
        </div>
      )}

      {/* Analysis Results */}
      {analysis && !loading && (
        <>
          <div className="card mb-10 text-center">
            <h2 className="text-sm uppercase tracking-widest opacity-60 mb-2">
              Final Investment Verdict
            </h2>

            <div className={`text-5xl font-black p-8 rounded-3xl mb-8 inline-block ${
              (analysis.decision?.finalDecision || '').includes('BUY') ? 'bg-green-900/30 text-green-400 border border-green-500/30' : 
              (analysis.decision?.finalDecision || '').includes('SELL') ? 'bg-red-900/30 text-red-400 border border-red-500/30' : 'bg-gray-800 text-gray-300 border border-gray-700'
            }`}>
              {analysis.decision?.finalDecision || 'N/A'}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-left">
              <div className="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                <p className="text-xs uppercase opacity-60 mb-1">Confidence Score</p>
                <p className="text-2xl font-bold">{analysis.decision?.finalConfidenceScore || 0}/10</p>
              </div>
              <div className="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                <p className="text-xs uppercase opacity-60 mb-1">Risk Level</p>
                <p className="text-2xl font-bold">{analysis.risk?.riskLevel || 'N/A'}</p>
              </div>
              <div className="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                <p className="text-xs uppercase opacity-60 mb-1">Learning Boost</p>
                <p className="text-2xl font-bold">+{analysis.learning?.learningBoost || 0}</p>
              </div>
              <div className="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                <p className="text-xs uppercase opacity-60 mb-1">Performance Score</p>
                <p className="text-2xl font-bold">+{analysis.performance?.performanceScore || 0}</p>
              </div>
            </div>

            <div className="mt-10 p-6 bg-white/5 rounded-2xl border border-white/10 text-left">
              <p className="text-lg opacity-90 leading-relaxed">
                <span className="font-bold text-white">AI Reasoning:</span> {analysis.decision?.reason || 'No reasoning provided.'}
              </p>
              <div className="mt-6 flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                <span className="text-blue-400 font-bold">Recommended Action:</span>
                <span className="text-white font-medium italic">
                  {analysis.decision?.finalDecision === "STRONG BUY"
                    ? "Accumulate aggressively"
                    : analysis.decision?.finalDecision === "BUY"
                    ? "Accumulate gradually"
                    : analysis.decision?.finalDecision === "SELL"
                    ? "Reduce exposure"
                    : "Monitor closely"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {agentCards.map((agent, index) => (
              <div key={index} className="card hover:border-white/30 transition-all cursor-default">
                <h2 className="text-xl font-semibold mb-4 border-b border-white/10 pb-2">
                  {agent.title}
                </h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-80">{agent.content}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <span className="p-2 bg-blue-500 rounded-lg text-xs">AI</span>
              Comprehensive Analysis Report
            </h2>

            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
                <span className="text-sm opacity-60">Company:</span>
                <span className="text-xl font-bold text-white">{analysis.stock}</span>
                <span className="ml-auto px-3 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded-full border border-green-500/30">LATEST REPORT</span>
              </div>

              <div className="whitespace-pre-wrap leading-relaxed text-gray-300 bg-black/20 p-6 rounded-2xl border border-white/5">
                {analysis.analysis?.stockFundamentals || "Detailed analysis content provided by agents above."}
              </div>

              <div className="p-6 bg-yellow-500/5 border border-yellow-500/10 rounded-2xl">
                <h3 className="text-yellow-500 font-bold mb-2">🔄 Rebalancing Advice</h3>
                <p className="opacity-80 italic">{analysis.rebalancing?.rebalancingAdvice || "No rebalancing needed at this time."}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}