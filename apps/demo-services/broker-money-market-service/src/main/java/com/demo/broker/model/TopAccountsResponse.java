package com.demo.broker.model;

import java.util.List;

public class TopAccountsResponse {
    private Integer count;
    private List<TopAccountRecord> accounts;

    public Integer getCount() { return count; }
    public void setCount(Integer count) { this.count = count; }
    public List<TopAccountRecord> getAccounts() { return accounts; }
    public void setAccounts(List<TopAccountRecord> accounts) { this.accounts = accounts; }
}
