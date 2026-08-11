import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, MessageSquare } from 'lucide-react';
import { formatISODate } from '../utils';
import { displayTaskId } from '../../../utils/taskDisplay';

export function WorkerDetail({ data }: { data: any }) {
  const [showTasks, setShowTasks] = useState(true);

  return (
    <div className="expand-panel">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Posts</p>
          <p className="text-white font-bold text-base sm:text-lg">{data.posts}</p>
        </div>
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Comments</p>
          <p className="text-white font-bold text-base sm:text-lg">{data.comments}</p>
        </div>
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Completed</p>
          <p className="text-white font-bold text-base sm:text-lg">{data.tasks?.length ?? 0}</p>
        </div>
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Earnings</p>
          <p className="text-primary-400 font-bold text-base sm:text-lg">₹{(data.totalAmount ?? 0).toLocaleString('en-IN')}</p>
        </div>
      </div>

      {/* Earnings breakdown */}
      <div className="bg-dark-800/30 rounded-xl p-3 border border-dark-700/30 mb-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <p className="text-dark-300">
            Posts: <span className="text-white font-medium">{data.posts} × ₹{data.postRate} = ₹{(data.postsEarnings ?? 0).toLocaleString('en-IN')}</span>
          </p>
          <p className="text-dark-300">
            Comments: <span className="text-white font-medium">{data.comments} × ₹{data.commentRate} = ₹{(data.commentsEarnings ?? 0).toLocaleString('en-IN')}</span>
          </p>
          <p className="text-white font-semibold ml-auto">
            Total: ₹{(data.totalAmount ?? 0).toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Task list toggle */}
      <button
        onClick={() => setShowTasks(!showTasks)}
        className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 mb-3"
      >
        {showTasks ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {showTasks ? 'Hide' : 'Show'} Tasks ({data.tasks?.length ?? 0})
      </button>

      {showTasks && data.tasks && (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th className="text-left text-dark-400 font-medium py-2 px-2">Task ID</th>
                  <th className="text-center text-dark-400 font-medium py-2 px-2">Type</th>
                  <th className="text-center text-dark-400 font-medium py-2 px-2">Created</th>
                  <th className="text-right text-dark-400 font-medium py-2 px-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((task: any) => (
                  <tr key={task.id} className="border-b border-dark-800/50">
                    <td className="py-2 px-2">
                      <span className="font-mono text-xs text-white">{displayTaskId(task.id, task.type, task.externalTaskId)}</span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`status-badge ${task.type === 'POST' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                        {task.type}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-dark-300 text-xs">
                      {task.createdAt ? formatISODate(task.createdAt) : '-'}
                    </td>
                    <td className="py-2 px-2 text-right text-white">₹{task.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {data.tasks.map((task: any) => (
              <div key={task.id} className="bg-dark-800/40 rounded-lg p-3 border border-dark-700/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-white">{displayTaskId(task.id, task.type, task.externalTaskId)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${task.type === 'POST' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                    {task.type}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-dark-400 flex items-center gap-1">
                    {task.type === 'POST' ? <FileText className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                    {task.createdAt ? formatISODate(task.createdAt) : '-'}
                  </span>
                  <span className="text-white font-medium">₹{task.amount}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
