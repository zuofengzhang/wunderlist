/* global wunderlist, console */
wunderlist.database = (function(wunderlist, html, global, undefined){
  //"use strict";
  
  var DB_NAME  = "wunderlist",
      DB_TITLE = "Wunderlist",
      DB_BYTES = 5*1024*1024, // 5MB
      db;

  var log = console.log.bind(console);
  var err = console.error.bind(console);
  var nop = function(){};

  function printf(text){
    var i = 1, args = arguments;
    return text.replace(/\?/g, function(){
      return args[i++] || "";
    });
  }

  function execute(sql){
    var args = Array.prototype.slice.call(arguments, 0);
    var caller = arguments.callee.caller;
    function error(){
      err([args, caller.name].concat(arguments));
    }
    var callback = function(){
      log([args, caller.name].concat(arguments));
    };
    if(typeof args[args.length-1] === 'function'){
      callback = args.pop();
    }

    sql = printf.apply(null, args);
    db.transaction(function(tx){
      tx.executeSql(sql, [], function(t, result){
        callback(result);
      }, error);
    });
  }
  
  function executeParallel(queue, callback){
    var output = [], current;
    callback = callback||log;
    var handler = function(result) {
      var rows = result.rows, outRows = [];
      for(var i = 0, l = rows.length; i < l; i++) {
        outRows.push(rows.item(i));
      }
      output.push(outRows);
      if(queue.length === 0 && typeof callback === 'function'){
        callback(output);
      }
    };

    while((current = queue.shift()) !== undefined){
      execute(current, handler);
    }
  }

  var createlistsSQL = "CREATE TABLE IF NOT EXISTS lists (id INTEGER PRIMARY KEY AUTOINCREMENT, online_id INTEGER DEFAULT 0, "+
                   "name TEXT, position INTEGER DEFAULT 0, version INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, "+
                   "inbox INTEGER DEFAULT 0, shared INTEGER DEFAULT 0)";
  var createtasksSQL = "CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, online_id INTEGER DEFAULT 0, "+
                   "name TEXT, list_id TEXT, note TEXT DEFAULT '', date INTEGER DEFAULT 0, done_date INTEGER DEFAULT 0, "+
                   "done INTEGER DEFAULT 0, position INTEGER DEFAULT 0, important INTEGER DEFAULT 0, version INTEGER DEFAULT 0, "+
                   "deleted INTEGER DEFAULT 0)";
  function init() {
    db = global.openDatabase(DB_NAME, "", DB_TITLE, DB_BYTES);
    executeParallel([createlistsSQL, createtasksSQL], nop);
  }

  /**
   * Gets list(s) from the database. 
   * @param list_id (Optional) - numeric id of a list to fetch (for getting individual lists)
   * @param callback - function to call with an array of fetched list
   * TODO: getTasks looks very similar, try to merge.
   */
  var getListsSQL = "SELECT lists.*, (SELECT COUNT(tasks.id) FROM tasks WHERE tasks.list_id = lists.id AND deleted = 0 AND done = 0) " +
                        "as taskCount FROM lists WHERE lists.deleted = 0 ? ORDER BY lists.inbox DESC, lists.position ASC";
  function getLists(list_id, callback) {
    var where = '';
    callback = callback||log;

    if (typeof list_id === 'number'){
      where += ' AND lists.id = ' + list_id;
    }

    execute(getListsSQL, where, function(result){
      var rows = result.rows, row, lists = [];
      for(var i = 0, l = rows.length; i < l; i++) {
        lists.push(rows.item(i));
      }
      callback(lists);
    });
    
    return [];
  }

  var getTasksSQL = "SELECT * FROM tasks WHERE deleted = 0 AND done = 0 ? ORDER BY important DESC, position ASC";
  function getTasks(task_id, list_id, callback) {
    var where = '';
    callback = callback||log;

    if (typeof task_id === 'number' && task_id > 0){
      where += " AND id = " + task_id;
    }
    if (typeof list_id === 'number' && list_id > 0){
      where += " AND list_id = " + list_id;
    }

    execute(getTasksSQL, where, function(result){
      var rows = result.rows, row, tasks = [];
      for(var i = 0, l = rows.length; i < l; i++) {
        tasks.push(rows.item(i));
      }
      callback(tasks);
    });

    return [];
  }

  function truncate() {
    execute("DELETE FROM lists");
    execute("DELETE FROM tasks");
    execute("DELETE FROM sqlite_sequence WHERE name = 'lists'");
    execute("DELETE FROM sqlite_sequence WHERE name = 'tasks'");
  }
  
  function existsById(type, id, callback) {
    callback = callback||log;
    execute("SELECT id FROM '?' WHERE id = ? AND deleted = 0", type, id, function(result){
      callback(result.rows.length > 0);
    });
    return false;
  }

  function existsByOnlineId(type, online_id, callback) {
    callback = callback||log;
    var result = execute("SELECT id FROM '?' WHERE online_id = ? AND deleted = 0", type, online_id, function(result){
      callback(result.rows.length > 0);
    });
    return false;
  }

  function hasElementsWithoutOnlineId(type, callback) {
    callback = callback||log;
    execute("SELECT id FROM ? WHERE online_id = 0", type, function(result){
      callback(result.rows.length > 0);
    });
    return false;
  }

  function getDataForSync(type, fields, where, return_object, callback) {
    type = type || 'lists';
    return_object = return_object || true;
    fields = fields || '*';
    callback = callback||log;

    var sql  = "SELECT " + fields + " FROM " + type;
    var values = {}, i = 0, y, max;

    if(where !== undefined){
      sql += ' WHERE ' + where;
    }

    execute(sql, function(result){
      var rows = result.rows, row;
      for(var i = 0, l = rows.length; i < l; i++) {
        row = rows.item(i);
        if(return_object){
          values[i] = row;
        } else {
          values = row;
        }
      }
      callback(values);
    });

    return values;
  }

  function deleteNotSyncedElements() {
    execute("DELETE FROM tasks WHERE deleted = 1 AND online_id = 0");
    execute("DELETE FROM lists WHERE deleted = 1 AND online_id = 0");
  }

  var deleteElementsSQL = "DELETE FROM '?' WHERE online_id = ?";
  function deleteElements(type, online_id) {
    execute(deleteElementsSQL, type, online_id);
  }

  var createListByOnlineIdSQL = "INSERT INTO lists (online_id, name, deleted, position, version, inbox, shared) VALUES(?, '?', ?, ?, ?, ?, ?) ";
  function createListByOnlineId(id, name, deleted, position, version, inbox, shared) {
    execute(createListByOnlineIdSQL, id, name, deleted, position, version, inbox, shared);
  }

  var getListOnlineIdByIdSQL = "SELECT online_id FROM lists WHERE id = ?";
  function getListOnlineIdById(list_id, callback) {
    callback = callback||log;
    execute(getListOnlineIdByIdSQL, list_id, function(result){
      if(result.rows.length > 0){
        callback(result.rows.item(0).online_id);
      }
    });
  }

  var getListIdByOnlineIdSQL = "SELECT id FROM lists WHERE online_id = ?";
  function getListIdByOnlineId(online_id, callback) {
    callback = callback||log;
    execute(getListIdByOnlineIdSQL, online_id, function(result){
      if(result.rows.length > 0){
        callback(result.rows.item(0).id);
      }
    });
  }

  var deleteTaskByListIdSQL = "DELETE FROM tasks WHERE list_id = ?";
  var updateListByOnlineIdSQL = "UPDATE lists SET name = '?', deleted = ?, position = ?, version = ?, inbox = ?, shared = ? WHERE online_id = ?";
  function updateListByOnlineId(id, name, deleted, position, version, inbox, shared) {
    if (deleted === 1 && shared === 1) {
      getListIdByOnlineId(id, function(list_id){
        execute(deleteTaskByListIdSQL, list_id);
      });
    }
    execute(updateListByOnlineIdSQL, name, deleted, position, version, inbox, shared, id);
  }

  function updateBadgeCount(filter, callback) {
    if (filter !== undefined && (filter === 'today' || filter === 'overdue')) {
      var sql  = "SELECT id AS count FROM tasks WHERE ";
      var date = html.getWorldWideDate(); // Current date
      callback = callback||log;

      switch(filter) {
        case 'today':
          sql += "tasks.date = " + date + " AND tasks.date != 0 AND tasks.done = 0 AND tasks.deleted = 0";
          break;
        case 'overdue':
          sql += "tasks.done = 0 AND tasks.date < " + date + " AND tasks.date != 0 AND tasks.deleted = 0";
          break;
      }
      execute(sql, function(result){
        callback(result.rows.length);
      });
    }
    return 0;
  }

  var lastDoneTasksSQL = "SELECT tasks.id AS task_id, tasks.name, tasks.done, tasks.important, tasks.position, tasks.date, tasks.list_id, " +
                         "tasks.done_date, tasks.note FROM tasks WHERE tasks.done = 1 AND list_id = '?' AND tasks.deleted = 0 ORDER BY "+
                         "tasks.done_date DESC";
  function getLastDoneTasks(list_id, callback) {
    var doneListsTasks = [];
    callback = callback||log;

    execute(lastDoneTasksSQL, list_id, function(result){
      var rows = result.rows, row;
      for(var i = 0, l = rows.length; i < l; i++) {
        var values = rows.item(i);
        var days   = wunderlist.utils.calculateDayDifference(values.done_date);
        var htmlId = days.toString();
        if (wunderlist.utils.is_array(doneListsTasks[htmlId]) === false){
          doneListsTasks[htmlId] = [];
        }
        var markup = html.generateTaskHTML(values.task_id, values.name, values.list_id, values.done, values.important, values.date, values.note);
        doneListsTasks[htmlId].push(markup);
      }
      callback(doneListsTasks);
    });
    return doneListsTasks;
  }

  function getLastListPosition(callback) {
    callback = callback||log;
    execute("SELECT position FROM lists WHERE deleted = 0 ORDER BY position DESC LIMIT 1",function(result){
      if(result.rows.length > 0){
        callback(result.rows.item(0).position);
      }
    });
    return 0;
  }

  function insertList(list, callback){
    callback = callback||log;

    if (typeof list.name !== 'string' || list.name.length === 0) {
      callback(new Error("Invalid name for the list"));
    }

    if (typeof list.position === 'undefined'){
      list.position = getLastListPosition() + 1;
    }
    list.version = 0;
    list.name    = html.convertString(list.name, 255);

    var first  = true, fields = '', values = '';
    for (var property in list) {
      if (list[property] !== undefined && $.isFunction(list[property]) === false) {
        if (wunderlist.utils.in_array(property, list.properties) === true) {
          fields += (first === false ? ', ' : '') + property;
          values += (first === false ? ', ' : '') + "'" + list[property] + "'";
          first = false;
        }
      }
    }

    if (fields !== '' && values !== '') {
      execute("INSERT INTO lists (?) VALUES (?)", fields, values, function(result){
        callback(result.insertId);
      });
    }
    // Reset the properties of the given list object
    list.setDefault();
    return 0;
  }

  function getLastListId(callback) {
    callback = callback||log;
    execute("SELECT id FROM lists ORDER BY id DESC LIMIT 1", function(result){
      if(result.rows.length > 0){
        callback(result.rows.item(0).id);
      }
    });
    return 0;
  }



/***********************************************
***** TODO: complete the following methods *****
************************************************/
  
  /**
   * Filter functions
   * TODO: move out any DOM stuff to frontend
   */

  function getFilteredTasks(filter, date_type, printing){}
  function getFilteredTasksForPrinting(type, date_type){}

  function createStandardElements(){}
  function updateTaskByOnlineId(online_id, name, date, done, list_id, position, important, done_date, deleted, version, note) {}
  function createTaskByOnlineId(online_id, name, date, done, list_id, position, important, done_date, deleted, version, note) {}
  function createTuts(list_id){}
  function recreateTuts(){}
  function fetchData(resultSet){}
  function updateList(noversion){}
  function insertTask(){}
  function updateTask(noVersion){}
  function getLastTaskPosition(list_id){}
  function search(query){}
  function isDeleted(type, online_id){}
  function isShared(list_id){}
  function isSynced(list_id){}
  function updateTaskCount(list_id){}
  function getListIdsByTaskId(task_id){}

  return {
    "init": init,
    "getLists": getLists,
    "getTasks": getTasks,
    "createStandardElements": createStandardElements,
    "truncate": truncate,
    "existsById": existsById,
    "existsByOnlineId": existsByOnlineId,
    "hasElementsWithoutOnlineId": hasElementsWithoutOnlineId,
    "getDataForSync": getDataForSync,
    "deleteNotSyncedElements": deleteNotSyncedElements,
    "deleteElements": deleteElements,
    "createListByOnlineId": createListByOnlineId,
    "getListOnlineIdById": getListOnlineIdById,
    "getListIdByOnlineId": getListIdByOnlineId,
    "updateListByOnlineId": updateListByOnlineId,
    "updateTaskByOnlineId": updateTaskByOnlineId,
    "createTaskByOnlineId": createTaskByOnlineId,
    "updateBadgeCount": updateBadgeCount,
    "getLastDoneTasks": getLastDoneTasks,
    "insertList": insertList,
    "getLastListId": getLastListId,
    "getLastListPosition": getLastListPosition,
    "getFilteredTasks": getFilteredTasks,
    "getFilteredTasksForPrinting": getFilteredTasksForPrinting
  };
})(wunderlist, html, window);