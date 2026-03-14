package com.demo.dtcc.model;

public class ObligationRecord {
    private String obligationId;
    private String accountId;
    private String investorId;
    private String issuerId;
    private String currency;
    private Double amount;
    private String status;

    public String getObligationId() { return obligationId; }
    public void setObligationId(String obligationId) { this.obligationId = obligationId; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public String getInvestorId() { return investorId; }
    public void setInvestorId(String investorId) { this.investorId = investorId; }
    public String getIssuerId() { return issuerId; }
    public void setIssuerId(String issuerId) { this.issuerId = issuerId; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public Double getAmount() { return amount; }
    public void setAmount(Double amount) { this.amount = amount; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
