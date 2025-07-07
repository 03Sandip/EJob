const express = require("express");
const router = express.Router();
const Employee = require("../models/job");
const Notification = require("../models/notification");

// ➕ Add a new employee
router.post("/add", async (req, res) => {
  try {
    const emp = new Employee(req.body);
    await emp.save();
    res.status(200).json({ message: "Employee added", emp });
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: "Employee ID must be unique" });
    } else {
      res.status(500).json({ error: "Server error", details: err });
    }
  }
});

// 👇 Get all employees
router.get("/all", async (req, res) => {
  try {
    const employees = await Employee.find().sort({ createdAt: 1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch employees", details: err });
  }
});

// 🔄 Find mutual and N-way matches & notify
router.get("/mutual", async (req, res) => {
  try {
    const employees = await Employee.find({ eligible: true }).sort({ createdAt: 1 });
    const used = new Set();
    const matchedGroups = [];

    function findCycle(currentEmp, visited, path) {
      if (visited.has(currentEmp.empId)) return null;
      visited.add(currentEmp.empId);
      path.push(currentEmp);

      for (const nextEmp of employees) {
        if (
          nextEmp.empId !== currentEmp.empId &&
          !used.has(nextEmp._id.toString()) &&
          currentEmp.desiredPlace === nextEmp.currentPlace &&
          currentEmp.designation === nextEmp.designation
        ) {
          if (
            nextEmp.desiredPlace === path[0].currentPlace &&
            nextEmp.designation === path[0].designation
          ) {
            return [...path, nextEmp];
          }

          const cycle = findCycle(nextEmp, new Set(visited), [...path]);
          if (cycle) return cycle;
        }
      }

      return null;
    }

    for (const emp of employees) {
      if (used.has(emp._id.toString())) continue;
      const group = findCycle(emp, new Set(), []);
      if (group && group.length > 1) {
        const now = new Date();

        for (let i = 0; i < group.length; i++) {
          const member = group[i];
          member.matchFoundAt = now;
          member.applied = false;
          await member.save();

          // 🔍 Find the actual holder of the desired place
          const holder = group.find(e => e.currentPlace === member.desiredPlace);
          const msg = holder
            ? `N-way match: desired ${member.desiredPlace}, held by ${holder.empId}`
            : `N-way match: desired ${member.desiredPlace}, holder not found`;

          const exists = await Notification.findOne({ empId: member.empId, message: msg });
          if (!exists) {
            await Notification.create({ empId: member.empId, message: msg });
          }

          used.add(member._id.toString());
        }

        matchedGroups.push(group);
      }
    }

    res.json({ count: matchedGroups.length, matchedGroups });
  } catch (err) {
    res.status(500).json({ error: "Error finding matches", details: err });
  }
});

// ✅ Apply for transfer (once only)
router.post("/apply/:empId", async (req, res) => {
  try {
    const emp = await Employee.findOne({ empId: req.params.empId });
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    if (emp.applied) {
      return res.status(400).json({ error: "You have already applied for transfer." });
    }

    const now = new Date();
    if (emp.matchFoundAt && now - new Date(emp.matchFoundAt) > 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: "Match expired. Please wait for a new match." });
    }

    emp.applied = true;
    await emp.save();

    res.status(200).json({ message: "Applied successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to apply", details: err });
  }
});

// 📦 Get employee apply status.
router.get("/status/:empId", async (req, res) => {
  try {
    const emp = await Employee.findOne({ empId: req.params.empId });
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    res.json({ applied: emp.applied });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch status", details: err });
  }
});

module.exports = router;
