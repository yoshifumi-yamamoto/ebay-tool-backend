const accountService = require('../services/accountService');

exports.createAccount = async (req, res) => {
    try {
        const account = await accountService.createAccount(req.body);
        res.status(201).json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAccountsByUserId = async (req, res) => {
    try {
        const accounts = await accountService.getAccountsByUserId(req.params.userId);
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateAccount = async (req, res) => {
    try {
        const account = await accountService.updateAccount(req.params.id, req.body);
        res.json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
