const supabase = require('../supabaseClient');

const saveSchedules = async (scheduleData, userId) => {
    try {
        const { taskId, days_of_week, time } = scheduleData;
        const enabled = true; // 初期状態を有効に設定

        if (!days_of_week || !Array.isArray(days_of_week)) {
            throw new Error('Invalid days_of_week value. It should be a non-null array.');
        }

        // 既存のスケジュールを削除してから新しいスケジュールを挿入
        const { error: deleteError } = await supabase
            .from('inventory_management_schedules')
            .delete()
            .eq('task_id', taskId)
            .eq('user_id', userId);

        if (deleteError) {
            throw deleteError;
        }

        const { data, error } = await supabase
            .from('inventory_management_schedules')
            .insert({
                task_id: taskId,
                user_id: userId,
                time_of_day: time,
                enabled,
                days_of_week
            });

        if (error) {
            throw error;
        }
        return data;
    } catch (error) {
        console.error('Error saving schedules to Supabase:', error.message);
        throw error;
    }
};

const getSchedulesByTaskId = async (taskId) => {

    // スケジュールを取得
    const { data: schedules, error: schedulesError } = await supabase
        .from('inventory_management_schedules')
        .select('*, octoparse_tasks(task_name)')
        .eq('task_id', taskId);

    if (schedulesError) {
        console.error("Error fetching schedules:", schedulesError);
        throw schedulesError;
    }

    let taskName = '';

    // スケジュールが存在しない場合でも task_name を取得
    if (schedules.length === 0) {
        const { data: task, error: taskError } = await supabase
            .from('octoparse_tasks')
            .select('task_name')
            .eq('task_id', taskId);

        if (taskError || task.length === 0) {
            console.error("Error fetching task:", taskError || 'Task not found');
            return { task_name: '', schedules: [] }; // エラーを投げずに空のスケジュールを返す
        }
        taskName = task[0].task_name;
    } else {
        taskName = schedules[0].octoparse_tasks.task_name;
    }

    return { task_name: taskName, schedules };
};

const updateStatus = async (taskId, enabled) => {
    try {
        const { error } = await supabase
            .from('inventory_management_schedules')
            .update({ enabled })
            .eq('task_id', taskId);

        if (error) {
            throw error;
        }
    } catch (error) {
        console.error('Error updating schedule status:', error.message);
        throw error;
    }
};

const getAllSchedules = async () => {
    const { data: schedules, error: schedulesError } = await supabase
        .from('inventory_management_schedules')
        .select('*, octoparse_tasks(ebay_user_id)')
        .eq('enabled', true); // enabledがtrueのスケジュールのみを取得

    if (schedulesError) throw schedulesError;
    
    // ebay_user_idを各スケジュールに追加
    const updatedSchedules = schedules.map(schedule => ({
        ...schedule,
        ebay_user_id: schedule.octoparse_tasks.ebay_user_id,
        task_name: schedule.octoparse_tasks.task_name // 必要に応じて他のフィールドも追加
    }));

    return updatedSchedules;
};



module.exports = { saveSchedules, getSchedulesByTaskId, updateStatus, getAllSchedules };
